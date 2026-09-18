<#
.SYNOPSIS
  一次性为「民大工作台文章专家」创建发文章专用账号（幂等）。
.DESCRIPTION
  1. 用 .env 的 ADMIN_PASSWORD 登录超管；
  2. 创建 ARTICLE_BOT_USERNAME 账号（已存在则复用）；
  3. 分配角色 3「内容编辑」（含 content.news）；
  4. 把账号关联到当前全部站点（让登录返回站点列表、GET /websites 可见）；
  5. 把 ARTICLE_BOT_USERNAME / ARTICLE_BOT_PASSWORD 写回 .env。
.NOTES
  运行前确保 web-admin-go 已在 8001 端口运行，且 .env 里 ADMIN_PASSWORD 有效。
  示例：pwsh -File setup-account.ps1
#>
param(
  [string]$EnvFile   = "D:\Project\GEO\web-admin-go\.env",
  [string]$BaseUrl   = "http://localhost:8001",
  [string]$UserName  = "article-bot",
  [string]$DisplayName = "文章发布专家",
  [string]$Email     = "article-bot@deepagens.com"
)

$ErrorActionPreference = "Stop"

function Get-EnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $m = Select-String -Path $Path -Pattern "^\s*$([regex]::Escape($Key))\s*=" | Select-Object -First 1
  if (-not $m) { return $null }
  return ($m.Line -split '=', 2)[1].Trim()
}

function ConvertTo-JsonBody($obj) {
  return ($obj | ConvertTo-Json -Compress -Depth 6)
}

# 1) 登录超管
$adminPwd = Get-EnvValue $EnvFile "ADMIN_PASSWORD"
if (-not $adminPwd) { $adminPwd = $env:ADMIN_PASSWORD }
if (-not $adminPwd) { Write-Error "缺少 ADMIN_PASSWORD（.env 或环境变量），无法登录超管"; exit 1 }

try {
  $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/auth/login" `
    -ContentType "application/json" -Body (ConvertTo-JsonBody @{ username = "admin"; password = $adminPwd })
} catch {
  Write-Error "超管登录失败：$($_.Exception.Message)"; exit 1
}
$token = $login.access_token
if (-not $token) { Write-Error "登录响应缺少 access_token"; exit 1 }
$headers = @{ Authorization = "Bearer $token" }
Write-Host "登录成功，开始创建/复用专用账号…"

# 2) 生成强密码
$chars = (48..57) + (65..90) + (97..122)
$password = -join (1..20 | ForEach-Object { [char]($chars | Get-Random) })

# 3) 创建账号（幂等：已存在则注销后查找复用）
$userId = $null
try {
  $user = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/users" -Headers $headers `
    -ContentType "application/json" `
    -Body (ConvertTo-JsonBody @{ username = $UserName; email = $Email; password = $password; full_name = $DisplayName })
  $userId = $user.data.id
  Write-Host "已创建账号 $UserName (id=$userId)"
} catch {
  $list = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/users?search=$UserName" -Headers $headers
  $found = $list.data | Where-Object { $_.username -eq $UserName } | Select-Object -First 1
  if (-not $found) { Write-Error "创建账号失败且未查到已有账号：$($_.Exception.Message)"; exit 1 }
  $userId = $found.id
  Write-Host "账号 $UserName 已存在 (id=$userId)，跳过创建"
}

# 4) 分配角色 3「内容编辑」(content.news)
try {
  Invoke-RestMethod -Method Put -Uri "$BaseUrl/api/v1/users/$userId/roles" -Headers $headers `
    -ContentType "application/json" -Body (ConvertTo-JsonBody @{ role_ids = @(3) }) | Out-Null
  Write-Host "已分配角色“内容编辑”(role_id=3)"
} catch {
  Write-Warning "角色分配失败：$($_.Exception.Message)"
}

# 5) 关联全部站点（role=editor，含笔名）
try {
  $sites = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1/websites?limit=100" -Headers $headers
  $siteIds = @($sites.data | ForEach-Object { $_.id })
  if ($siteIds.Count -gt 0) {
    Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/users/$userId/websites/batch" -Headers $headers `
      -ContentType "application/json" `
      -Body (ConvertTo-JsonBody @{ website_ids = $siteIds; role = "editor"; pen_name = $DisplayName }) | Out-Null
    Write-Host "已关联 $($siteIds.Count) 个站点"
  } else {
    Write-Warning "当前没有站点可关联（后续发文章仍可直接指定 website_id）"
  }
} catch {
  Write-Warning "站点关联失败：$($_.Exception.Message)"
}

# 6) 写回 .env（幂等：已存在的键覆盖）
$content = if (Test-Path -LiteralPath $EnvFile) { Get-Content -LiteralPath $EnvFile -Raw } else { "" }
foreach ($pair in @(
    @("ARTICLE_BOT_USERNAME", "ARTICLE_BOT_USERNAME=$UserName"),
    @("ARTICLE_BOT_PASSWORD", "ARTICLE_BOT_PASSWORD=$password")
  )) {
  $key = $pair[0]; $line = $pair[1]
  if ($content -match "(?m)^\s*$([regex]::Escape($key))\s*=.*$") {
    $content = [regex]::Replace($content, "(?m)^\s*$([regex]::Escape($key))\s*=.*$", $line)
  } else {
    $content = $content.TrimEnd("`r", "`n") + "`r`n" + $line
  }
}
Set-Content -LiteralPath $EnvFile -Value $content -Encoding utf8 -NoNewline
Write-Host "已把 ARTICLE_BOT_USERNAME / ARTICLE_BOT_PASSWORD 写入 $EnvFile"
Write-Host "完成：技能将用 $UserName 登录并发文。"