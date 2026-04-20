$files = @(
    'index.html',
    'conferencias.html',
    'deportes.html',
    'ponentes.html',
    'administrador.html',
    'registro.html',
    'usuarios.html',
    'proyectos.html'
)

$basePath = 'c:\Users\ke5469\Industrial\Entorno_Pruebas_web\public'

foreach ($f in $files) {
    $path = Join-Path $basePath $f
    if (Test-Path $path) {
        $content = Get-Content $path -Raw -Encoding UTF8
        if ($content -notmatch 'embellecimiento\.html') {
            $old = '<a href="proyectos.html" class="nav-link">Proyectos</a>'
            $new = '<a href="proyectos.html" class="nav-link">Proyectos</a>' + "`r`n" + '            <a href="embellecimiento.html" class="nav-link">Embellecimiento</a>'
            $content = $content.Replace($old, $new)
            [System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::UTF8)
            Write-Host "Updated: $f"
        } else {
            Write-Host "Already has link: $f"
        }
    } else {
        Write-Host "Not found: $f"
    }
}
