<#
.SYNOPSIS
  一次性为「miao云海文章专家」创建发文章专用账号（幂等）。
.DESCRIPTION
  1. 用后台 .env 的 ADMIN_PASSWORD 登录超管；
  2. 创建发文账号（已存在则复用，不改其密码）；
  3. 分配角色 3「内容编辑」（含 content.news）；
  4. 把账号关联到当前全部站点（让登录返回站点列表、GET /websites 可见）；
  5. 打印账号与密码，供填入「设置 → 插件 → 深度云海」。
  本脚本不再写后台 .env：密码只留在 DSH 凭据存储里，后台项目不再多存一份。
.NOTES
  运行前确保 web-admin-go 已在其端口运行，且 .env 里 ADMIN_PASSWORD 有效。
  示例：pwsh -File setup-account.ps1
         pwsh -File setup-account.ps1 -Password 'Known-Strong-Passw0rd'
#>
param(
  [string]$EnvFile   = "D:\Project\GEO\web-admin-go\.env",
  [string]$BaseUrl   = "http://localhost:8001",
  [string]$UserName  = "article-bot",
  [string]$DisplayName = "文章发布专家",
  [string]$Email     = "article-bot@deepagens.com",
  [string]$Password  = ""
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

# 2) 生成强密码（仅创建新账号时使用）
$chars = (48..57) + (65..90) + (97..122)
if ($Password -eq "") {
  $Password = -join (1..20 | ForEach-Object { [char]($chars | Get-Random) })
}

# 3) 创建账号（幂等：已存在则复用，不重置密码）
$userId = $null
$created = $false
try {
  $user = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/users" -Headers $headers `
    -ContentType "application/json" `
    -Body (ConvertTo-JsonBody @{ username = $UserName; email = $Email; password = $Password; full_name = $DisplayName })
  $userId = $user.data.id
  $created = $true
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

# 6) 打印配置：密码只出现在这里，之后由 DSH 凭据存储保管
Write-Host ""
Write-Host "把下面三项填入 dsh 的「设置 → 插件 → 深度云海」：" -ForegroundColor Cyan
Write-Host "  后台地址：$BaseUrl"
Write-Host "  账号：    $UserName"
if ($created) {
  Write-Host "  密码：    $Password" -ForegroundColor Yellow
  Write-Host "（密码只显示这一次；请立即保存，之后无需再存到后台项目的 .env。）"
} else {
  Write-Host "  密码：    账号已存在，本次未改动；请沿用之前保存的密码。" -ForegroundColor Yellow
  Write-Host "（忘记密码时：在后台用户管理里重置，或换一个 -UserName 重新创建。）"
}
