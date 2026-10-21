# Warn & Alarm 자체 서명 인증서를 이 컴퓨터의 신뢰 목록에 넣습니다.
# 이 인증서로 서명된 실행 파일에서 '게시자를 확인할 수 없습니다' 경고가 사라집니다.
#
# 사용법: 이 파일을 마우스 오른쪽 클릭 -> "PowerShell에서 실행"
#         (관리자 권한이 필요합니다. UAC 창이 뜨면 '예'를 누르세요)
#
# 되돌리려면: certmgr.msc 에서 '신뢰할 수 있는 루트 인증 기관'과 '신뢰할 수 있는 게시자' 아래의
#             'Warn & Alarm' 인증서를 지우면 됩니다.

$ErrorActionPreference = 'Stop'
$cert = Join-Path $PSScriptRoot 'codesign.cer'

if (-not (Test-Path $cert)) { Write-Error "codesign.cer 를 찾을 수 없습니다: $cert"; exit 1 }

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "관리자 권한으로 다시 실행합니다..."
  Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
  exit
}

Import-Certificate -FilePath $cert -CertStoreLocation Cert:\LocalMachine\Root           | Out-Null
Import-Certificate -FilePath $cert -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null

Write-Host ""
Write-Host "완료했습니다. 이제 Warn & Alarm 실행 파일이 '게시자: Warn & Alarm' 으로 표시됩니다." -ForegroundColor Green
Write-Host "이미 열려 있던 탐색기 창이 있다면 한 번 닫았다 여세요."
Write-Host ""
Read-Host "엔터를 누르면 창이 닫힙니다"
