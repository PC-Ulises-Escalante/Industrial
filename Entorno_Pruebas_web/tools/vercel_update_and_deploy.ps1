# Update Vercel env vars and trigger redeploy (push empty commit or use CLI)
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $projectDir

# Values provided by user
$TOKEN = 'your-vercel-token-here'
$PROJECT = 'prj_on66RItHr8uUAcw2nD8C0nnQSv1R'
$DATABASE_URL = 'postgresql://postgres.zxqkbyxpfngpyierdpvc:Camarones1234Ca@aws-1-us-east-2.pooler.supabase.com:6543/postgres?sslmode=require&prepare_threshold=0'
$PGSSLMODE = 'require'
$JWT_SECRET = 'dev-secret-change-this-in-production'

$headers = @{ Authorization = "Bearer $TOKEN"; "Content-Type" = "application/json" }

try {
  $envs = Invoke-RestMethod -Method Get -Uri "https://api.vercel.com/v9/projects/$PROJECT/env" -Headers $headers
} catch {
  Write-Output "Failed to list envs: $_"
  exit 1
}

$keys = @('DATABASE_URL','PGSSLMODE','JWT_SECRET')

foreach ($key in $keys) {
  $entries = @()
  if ($envs -and $envs.envs) { $entries = $envs.envs | Where-Object { $_.key -eq $key -and ($_.target -contains 'production') } }
  if ($entries -and $entries.Count -gt 0) {
    foreach ($e in $entries) {
      $id = $e.id
      if ($key -eq 'DATABASE_URL') { $val = $DATABASE_URL } elseif ($key -eq 'PGSSLMODE') { $val = $PGSSLMODE } else { $val = $JWT_SECRET }
      try {
         Invoke-RestMethod -Method Patch -Uri "https://api.vercel.com/v9/projects/$PROJECT/env/$id" -Headers $headers -Body (@{ value = $val } | ConvertTo-Json -Depth 10)
         Write-Output ("Patched {0} (id {1})" -f $key, $id)
      } catch {
         Write-Output ("Failed to patch {0} id {1}: {2}" -f $key, $id, $_)
      }
    }
   } else {
   try {
     if ($key -eq 'DATABASE_URL') { $val = $DATABASE_URL } elseif ($key -eq 'PGSSLMODE') { $val = $PGSSLMODE } else { $val = $JWT_SECRET }
     $body = @{ key = $key; value = $val; target = @('production'); type = 'encrypted' } | ConvertTo-Json -Depth 10
     Invoke-RestMethod -Method Post -Uri "https://api.vercel.com/v9/projects/$PROJECT/env" -Headers $headers -Body $body
     Write-Output ("Created {0}" -f $key)
   } catch {
     Write-Output ("Failed to create {0}: {1}" -f $key, $_)
   }
  }
}

# Try to trigger redeploy via git push if possible
$remote = git config --get remote.origin.url 2>$null
if ($remote) {
  Write-Output "Git remote found: $remote -- creating empty commit and pushing"
  git commit --allow-empty -m "Trigger Vercel redeploy from assistant" 2>$null
  $push = git push 2>&1
  Write-Output $push
} else {
  Write-Output "No git remote found, attempting Vercel CLI deploy"
  try {
    npx vercel --prod --token $TOKEN --yes --project $PROJECT
  } catch {
    Write-Output "Vercel CLI deploy failed: $_"
  }
}
