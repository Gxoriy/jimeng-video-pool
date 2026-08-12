$loginBody = '{"username":"admin","password":"admin123456"}'
$loginResp = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/auth/login' -Method POST -ContentType 'application/json' -Body $loginBody -SessionVariable s -UseBasicParsing
$listResp = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/admin/jimeng-accounts' -Method GET -WebSession $s -UseBasicParsing
$list = $listResp.Content | ConvertFrom-Json
if ($list.data.Count -gt 0) {
  $firstId = $list.data[0].id
  Write-Host "FIRST_ACCOUNT_ID:" $firstId
  $detailResp = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/admin/jimeng-accounts/$firstId/detail" -Method GET -WebSession $s -UseBasicParsing
  Write-Host "DETAIL_HTTP:" $detailResp.StatusCode
  $detail = $detailResp.Content | ConvertFrom-Json
  Write-Host "DETAIL_CODE:" $detail.code
  Write-Host "DETAIL_KEYS:" ($detail.data.PSObject.Properties.Name -join ',')
  Write-Host "DETAIL_LABEL:" $detail.data.label
  Write-Host "DETAIL_SESSIONID:" $detail.data.sessionid
} else {
  Write-Host "NO_ACCOUNTS_YET"
}
