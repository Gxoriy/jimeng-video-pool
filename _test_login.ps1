$body = '{"username":"admin","password":"admin123456"}'
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/auth/login' -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing
  Write-Host "HTTP_OK"
  Write-Host $r.Content
} catch {
  Write-Host "HTTP_ERR"
  Write-Host $_.Exception.Response.StatusCode
  Write-Host $_.ErrorDetails.Message
}
