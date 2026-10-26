# -*- coding: utf-8 -*-
"""WeChat desktop sidecar service for the dsh-wechat plugin.

Speaks one JSON object per line over stdin/stdout:

  request : {"id": <int>, "tool": <name>, "args": {...}}
  response: {"id": <int>, "ok": true, "result": <str>}
          | {"id": <int>, "ok": false, "error": <str>}

Tools: wechat_doctor, wechat_contacts, wechat_group_members,
wechat_messages, wechat_send. Reading goes through decrypted local
WeChat 4.x databases (wechatauto); sending drives the WeChat window
(UIA + OCR) and therefore requires an interactive desktop session.
"""

from __future__ import annotations

import json
import re
import sys
import threading
import time

_DB_LOCK = threading.Lock()
_DB = None
_SEND_LOCK = threading.Lock()


def _db():
    """Lazy per-process WeChatDB singleton; key derivation is expensive."""
    global _DB
    with _DB_LOCK:
        if _DB is None:
            import wechatauto

            _DB = wechatauto.WeChatDB()
        return _DB


def _xml_body(text: str, limit: int = 200) -> str:
    """One-line readable summary for XML payloads (appmsg/emoji/etc.)."""
    body = (text or "").replace("\n", " ")
    if not body.lstrip().startswith(("<?xml", "<msg")):
        # Group texts carry a `senderwxid: ` prefix before the XML body.
        prefixed = re.match(r"^(\S{1,64}?:)\s*((?:<\?xml|<msg).*)$", body)
        if not prefixed:
            return body[:limit]
        body = prefixed.group(2)
        prefix = prefixed.group(1)
    else:
        prefix = ""
    stripped = " ".join(re.sub(r"<[^>]+>", " ", body).split())
    if not stripped:
        attrs = dict(re.findall(r'\b(\w+)="([^"]{1,60})"', body))
        stripped = " ".join(
            f"{key}={attrs[key]}" for key in ("title", "des", "size", "playlength")
            if key in attrs
        )
    return (prefix + " [非文本] " + stripped)[:limit]


def _resolve_chat(db, who: str) -> str:
    """Accept a display name, remark, wxid, or chatroom id; return the username."""
    who = (who or "").strip()
    if not who:
        raise ValueError("会话名不能为空：请给出昵称、备注、wxid 或群号")
    if who == "filehelper" or who.endswith("@chatroom") or who.startswith("wxid_"):
        return who
    try:
        hits = db.search_contact(who) or []
    except Exception:
        hits = []
    exact = [h for h in hits if who in (h.get("nick_name"), h.get("remark"))]
    if len(exact) == 1:
        return exact[0]["username"]
    if len(exact) > 1:
        names = ", ".join(h["username"] for h in exact[:5])
        raise ValueError(f"「{who}」同时是 {len(exact)} 个联系人的昵称/备注，请改用 wxid：{names}")
    return who


def _message_view(row: dict) -> dict:
    sender = row.get("sender_username") or row.get("sender_id") or ""
    nickname = ""
    try:
        nickname = _db().get_nickname(sender) if sender else ""
    except Exception:
        nickname = ""
    return {
        "seq": row.get("sort_seq"),
        "time": row.get("create_time"),
        "sender": nickname or sender,
        "sender_id": sender,
        "is_self": bool(row.get("is_self")),
        "type": row.get("type") or row.get("local_type"),
        "content": _xml_body(row.get("content") or ""),
    }


def tool_wechat_doctor() -> str:
    result = {}
    try:
        db = _db()
        conn = db._contact_conn()
        total = conn.execute("SELECT COUNT(*) FROM contact").fetchone()[0]
        conn.close()
        result["contacts_total"] = total
        result["db_readable"] = True
        try:
            info = db.get_self_info()
            result["account"] = {
                "wxid": info.get("username", ""),
                "nickname": info.get("nick_name") or "",
            } if isinstance(info, dict) else str(info)
        except Exception:
            result["account"] = "unknown"
    except Exception as error:
        result["db_readable"] = False
        result["error"] = f"{type(error).__name__}: {error}"
        return json.dumps(result, ensure_ascii=False)
    try:
        import wechatauto.guia as guia

        windows = guia.find_main_windows() if hasattr(guia, "find_main_windows") else []
        result["send_side"] = {
            "wechat_windows": len(windows),
            "note": "发送工具要求：微信已登录且未最小化到托盘、在交互桌面会话中运行",
        }
    except Exception as error:
        result["send_side"] = {"error": f"{type(error).__name__}: {error}"}
    return json.dumps(result, ensure_ascii=False)


def tool_wechat_contacts(kind="person", keyword="", page=1, page_size=50) -> str:
    if kind not in ("person", "group", "official", "all"):
        raise ValueError("kind 只能是 person / group / official / all")
    page = max(1, int(page))
    page_size = min(200, max(1, int(page_size)))
    db = _db()
    conn = db._contact_conn()
    try:
        sql = "SELECT username, nick_name, remark FROM contact"
        conditions = []
        params: list = []
        if kind == "group":
            conditions.append("username LIKE '%@chatroom'")
        elif kind == "official":
            conditions.append("username LIKE 'gh_%'")
        elif kind == "person":
            conditions.append("username NOT LIKE '%@chatroom'")
            conditions.append("username NOT LIKE 'gh_%'")
            conditions.append("username NOT IN ('filehelper','weixin','fmessage','medianote','floatbottle')")
        if keyword:
            conditions.append("(nick_name LIKE ? OR remark LIKE ? OR username LIKE ?)")
            like = f"%{keyword}%"
            params.extend([like, like, like])
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)
        total = conn.execute(
            sql.replace("SELECT username, nick_name, remark", "SELECT COUNT(*)", 1),
            params,
        ).fetchone()[0]
        rows = conn.execute(
            sql + " ORDER BY (remark IS NULL OR remark=''), remark, nick_name LIMIT ? OFFSET ?",
            params + [page_size, (page - 1) * page_size],
        ).fetchall()
    finally:
        conn.close()
    items = [
        {"wxid": r["username"], "nickname": r["nick_name"] or "", "remark": r["remark"] or ""}
        for r in rows
    ]
    return json.dumps(
        {"total": total, "page": page, "page_size": page_size, "items": items},
        ensure_ascii=False,
    )


def tool_wechat_group_members(group, page=1, page_size=100) -> str:
    chatroom = _resolve_chat(_db(), group)
    if not chatroom.endswith("@chatroom"):
        raise ValueError(f"「{group}」不是群聊（解析结果：{chatroom}）。请用群名或群号（@chatroom 结尾）")
    page = max(1, int(page))
    page_size = min(500, max(1, int(page_size)))
    members = _db().get_group_members(chatroom)
    start = (page - 1) * page_size
    window = members[start:start + page_size]
    return json.dumps(
        {
            "group": chatroom,
            "total": len(members),
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "wxid": m.get("username", ""),
                    "nickname": m.get("nick_name") or "",
                    "remark": m.get("remark") or "",
                    "is_owner": bool(m.get("is_owner")),
                }
                for m in window
            ],
        },
        ensure_ascii=False,
    )


def tool_wechat_messages(chat, limit=20, since_seq=0) -> str:
    username = _resolve_chat(_db(), chat)
    limit = min(100, max(1, int(limit)))
    if since_seq:
        rows = _db().get_new_messages(username, since_seq=int(since_seq), limit=limit)
    else:
        rows = list(reversed(_db().get_messages(username, limit=limit)))
    return json.dumps(
        {"chat": username, "count": len(rows), "items": [_message_view(r) for r in rows]},
        ensure_ascii=False,
    )


def _weixin_exe_path():
    """Path of the running Weixin.exe, or None when WeChat is not running."""
    try:
        import psutil

        for proc in psutil.process_iter(["name", "exe"]):
            if (proc.info["name"] or "").lower() == "weixin.exe":
                return proc.info["exe"]
    except Exception:
        return None
    return None


def _enum_weixin_main_windows():
    """All top-level Weixin main-shaped windows, visible or not, largest first.

    The login/QR window is 296x388; real main windows are much larger, so the
    400x300 threshold keeps only them without requiring visibility.
    """
    import ctypes
    from ctypes import wintypes

    from wechatauto.demo_forward import PROCESS_NAME, _get_pid, _process_name

    user32 = ctypes.windll.user32
    rows = []
    callback = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def visit(hwnd, _lparam):
        pid = _get_pid(hwnd)
        if not pid or _process_name(pid) != PROCESS_NAME:
            return True
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        if not cls.value.startswith("Qt51514QWindowIcon"):
            return True
        if user32.IsIconic(hwnd):
            # A minimized window reports a 160x28 icon rect; class name still
            # identifies it. Rank minimized mains first: login windows never
            # minimize, so this wins over any sized candidate.
            rows.append((hwnd, float("inf")))
            return True
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        width, height = rect.right - rect.left, rect.bottom - rect.top
        if width >= 400 and height >= 300:
            rows.append((hwnd, width * height))
        return True

    user32.EnumWindows(callback(visit), 0)
    rows.sort(key=lambda row: -row[1])
    return [hwnd for hwnd, _area in rows]


def _ensure_wechat_visible(timeout_s=10):
    """Make a visible WeChat main window exist before driving the UI.

    Tray-minimized WeChat only hides its main window; restoring that window
    directly with ShowWindow revives it without side effects. Never launch
    Weixin.exe from here: that can spawn extra login windows instead of
    reviving the logged-in instance. A merely covered window needs nothing —
    wechatauto's send path calls bring_to_front itself.
    """
    import ctypes

    from wechatauto.demo_forward import find_main_windows

    if find_main_windows():
        return
    user32 = ctypes.windll.user32
    for hwnd in _enum_weixin_main_windows():
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE: un-hide (and un-minimize)
        user32.SetForegroundWindow(hwnd)
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        time.sleep(0.5)
        if find_main_windows():
            time.sleep(1.0)  # let the restored window settle before OCR
            return
    if _weixin_exe_path():
        raise RuntimeError("微信主窗口恢复失败：请手动打开微信主窗口后重试")
    raise RuntimeError("微信未运行：请先登录微信，再重试发送")


def tool_wechat_send(to, text) -> str:
    text = (text or "").strip()
    if not text:
        raise ValueError("消息内容不能为空")
    username = _resolve_chat(_db(), to)
    display = _db().get_nickname(username)
    with _SEND_LOCK:
        _ensure_wechat_visible()
        # Watermark before sending: quick_send's verify read-back can race the
        # database write, so a failed verify is re-checked against new rows.
        watermark = 0
        try:
            latest = _db().get_messages(username, limit=1)
            if latest:
                watermark = int(latest[0].get("sort_seq") or 0)
        except Exception:
            watermark = 0
        try:
            from wechatauto.guia import quick_send

            response = quick_send(text, display or username, verify=True)
            # WxResponse is a dict subclass: {status, message, data}, truthiness = is_success.
            ok = bool(getattr(response, "is_success", False))
            detail = (response.get("message") if isinstance(response, dict) else None) or ""
            confirmed_by = "verify"
            if not ok:
                time.sleep(2)
                rows = _db().get_new_messages(username, since_seq=watermark, limit=20)
                ok = any(text in (row.get("content") or "") for row in rows)
                confirmed_by = "database-recheck" if ok else confirmed_by
            return json.dumps(
                {
                    "sent": ok,
                    "to": username,
                    "confirmed_by": confirmed_by if ok else None,
                    "detail": str(detail),
                },
                ensure_ascii=False,
            )
        except Exception as error:
            return json.dumps(
                {
                    "sent": False,
                    "to": username,
                    "error": f"{type(error).__name__}: {error}",
                    "hint": "发送要求：微信已登录且窗口可用、在交互桌面会话（非服务/断开的 RDP）中运行 harness",
                },
                ensure_ascii=False,
            )


TOOLS = {
    "wechat_doctor": (tool_wechat_doctor, {}),
    "wechat_contacts": (
        tool_wechat_contacts,
        {"kind": str, "keyword": str, "page": int, "page_size": int},
    ),
    "wechat_group_members": (tool_wechat_group_members, {"group": str, "page": int, "page_size": int}),
    "wechat_messages": (tool_wechat_messages, {"chat": str, "limit": int, "since_seq": int}),
    "wechat_send": (tool_wechat_send, {"to": str, "text": str}),
}

REQUIRED = {
    "wechat_group_members": ("group",),
    "wechat_messages": ("chat",),
    "wechat_send": ("to", "text"),
}


def dispatch(tool: str, args: dict):
    entry = TOOLS.get(tool)
    if entry is None:
        raise ValueError(f"未知工具：{tool}")
    function, coercers = entry
    call_args = {}
    for name, coercer in coercers.items():
        value = args.get(name)
        if value is None:
            continue
        call_args[name] = coercer(value)
    for name in REQUIRED.get(tool, ()):
        if args.get(name) in (None, ""):
            raise ValueError(f"缺少必填参数：{name}")
    return function(**call_args)


def main() -> int:
    # The Node host always writes UTF-8 JSON, but Windows Python defaults
    # piped stdio to the ANSI code page (GBK) outside a UTF-8-mode shell.
    # Pin every stream to UTF-8 regardless of the ambient environment.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            request_id = request.get("id")
            result = dispatch(request.get("tool", ""), request.get("args") or {})
            response = {"id": request_id, "ok": True, "result": result}
        except Exception as error:
            response = {
                "id": request.get("id") if isinstance(request, dict) else None,
                "ok": False,
                "error": f"{type(error).__name__}: {error}",
            }
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
