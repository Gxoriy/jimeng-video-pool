$loginBody = '{"username":"admin","password":"admin123456"}'
$loginResp = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/auth/login' -Method POST -ContentType 'application/json' -Body $loginBody -SessionVariable s -UseBasicParsing
$listResp = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/admin/jimeng-accounts' -Method GET -WebSession $s -UseBasicParsing
$raw = $listResp.Content | ConvertFrom-Json
Write-Host "TOP_KEYS:" ($raw.PSObject.Properties.Name -join ',')
Write-Host "DATA_TYPE:" $raw.data.GetType().Name
if ($raw.data -is [System.Array]) {
  Write-Host "DATA_IS_ARRAY, COUNT:" $raw.data.Count
  if ($raw.data.Count -gt 0) { Write-Host "FIRST_ID:" $raw.data[0].id }
} else {
  Write-Host "DATA_KEYS:" ($raw.data.PSObject.Properties.Name -join ',')
}
