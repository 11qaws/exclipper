[CmdletBinding()]
param(
    [switch] $CheckOnly,
    [switch] $UseSavedCredentials,
    [string] $Repository = "11qaws/exclipper",
    [string] $ContextEndpoint =
        "https://exclipper-preanalysis-context.11qaws.workers.dev/v1/broadcast-context"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Read-RequiredSecret {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Prompt,
        [Parameter(Mandatory = $true)]
        [scriptblock] $Validate
    )

    $secure = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if (-not (& $Validate $plain)) {
            throw "$Prompt has an invalid format. The value was not stored."
        }
        return $plain
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $secure.Dispose()
    }
}

function New-Base64UrlSecret {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateRange(32, 128)]
        [int] $ByteCount
    )

    $bytes = New-Object byte[] $ByteCount
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes).
            TrimEnd([char] "=").
            Replace("+", "-").
            Replace("/", "_")
    }
    finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
        $generator.Dispose()
    }
}

function Get-UserProtectedActivationDirectory {
    $localRoot = [IO.Path]::GetFullPath($env:LOCALAPPDATA)
    $activationRoot = [IO.Path]::GetFullPath(
        (Join-Path $localRoot "ExClipper\activation")
    )
    if (
        -not $activationRoot.StartsWith(
            $localRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        (Split-Path -Leaf $activationRoot) -ne "activation"
    ) {
        throw "The protected activation directory is unsafe."
    }
    return $activationRoot
}

function Read-UserProtectedSecret {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("groq.dpapi", "qwen.dpapi")]
        [string] $FileName,
        [Parameter(Mandatory = $true)]
        [scriptblock] $Validate
    )

    $path = Join-Path (Get-UserProtectedActivationDirectory) $FileName
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "The protected $FileName activation value is missing."
    }
    $cipher = [IO.File]::ReadAllText($path).Trim()
    if ($cipher -notmatch "^[0-9a-f]+$") {
        throw "The protected $FileName activation value is invalid."
    }
    $secure = ConvertTo-SecureString $cipher
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if (-not (& $Validate $plain)) {
            throw "The protected $FileName activation value has an invalid format."
        }
        return $plain
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $secure.Dispose()
        $cipher = $null
    }
}

function Remove-UserProtectedActivationSecrets {
    $root = Get-UserProtectedActivationDirectory
    foreach ($fileName in @("groq.dpapi", "qwen.dpapi")) {
        $path = Join-Path $root $fileName
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Remove-Item -LiteralPath $path -Force
        }
    }
    if (
        (Test-Path -LiteralPath $root -PathType Container) -and
        (Get-ChildItem -LiteralPath $root -Force | Measure-Object).Count -eq 0
    ) {
        Remove-Item -LiteralPath $root -Force
    }
}

function Remove-PrivateTemporaryDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $leaf = Split-Path -Leaf $resolvedPath
    if (
        -not $resolvedPath.StartsWith(
            $temporaryRoot,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not $leaf.StartsWith(
            "exclipper-preanalysis-secrets-",
            [StringComparison]::Ordinal
        )
    ) {
        throw "Refused to delete an unsafe temporary path."
    }
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

function Assert-CommandAvailable {
    param([Parameter(Mandatory = $true)][string] $Name)

    if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "The $Name command is not available."
    }
}

$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$configurationPath = Join-Path $workspaceRoot "wrangler.preanalysis-context.jsonc"
if (-not (Test-Path -LiteralPath $configurationPath -PathType Leaf)) {
    throw "The dedicated Worker configuration is missing: $configurationPath"
}

Assert-CommandAvailable "npx"
Assert-CommandAvailable "gh"
Add-Type -AssemblyName System.Net.Http

Push-Location $workspaceRoot
try {
    & gh auth status --hostname github.com | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI authentication could not be verified."
    }
    & npx wrangler whoami | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Cloudflare Wrangler authentication could not be verified."
    }

    if ($CheckOnly) {
        Write-Host "Preanalysis Worker activation prerequisites are ready."
        return
    }

    $contextToken = New-Base64UrlSecret -ByteCount 48
    $mediaSigningKey = New-Base64UrlSecret -ByteCount 64
    if ($UseSavedCredentials) {
        $groqKey = Read-UserProtectedSecret -FileName "groq.dpapi" -Validate {
            param($value)
            $value -match "^gsk_[A-Za-z0-9_-]{32,512}$"
        }
        $qwenKey = Read-UserProtectedSecret -FileName "qwen.dpapi" -Validate {
            param($value)
            $value -match "^[^\s]{24,512}$"
        }
    }
    else {
        $groqKey = Read-RequiredSecret -Prompt "Groq API key" -Validate {
            param($value)
            $value -match "^gsk_[A-Za-z0-9_-]{32,512}$"
        }
        $qwenKey = Read-RequiredSecret -Prompt "Qwen API key" -Validate {
            param($value)
            $value -match "^[^\s]{24,512}$"
        }
    }

    $secretDirectory = Join-Path (
        [IO.Path]::GetTempPath()
    ) ("exclipper-preanalysis-secrets-" + [Guid]::NewGuid().ToString("N"))
    $secretFile = Join-Path $secretDirectory "secrets.json"
    try {
        New-Item -ItemType Directory -Path $secretDirectory | Out-Null
        $principal = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        & icacls $secretDirectory "/inheritance:r" "/grant:r" "${principal}:(OI)(CI)F" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "The temporary secret directory could not be access-restricted."
        }

        $secretPayload = [ordered] @{
            PREANALYSIS_CONTEXT_TOKEN = $contextToken
            PREANALYSIS_GROQ_API_KEY = $groqKey
            PREANALYSIS_QWEN_API_KEY = $qwenKey
            PREANALYSIS_MEDIA_SIGNING_KEY = $mediaSigningKey
        } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText(
            $secretFile,
            $secretPayload,
            [Text.UTF8Encoding]::new($false)
        )

        & npx wrangler deploy `
            --config $configurationPath `
            --secrets-file $secretFile
        if ($LASTEXITCODE -ne 0) {
            throw "The dedicated preanalysis Worker deployment failed."
        }
    }
    finally {
        $secretPayload = $null
        Remove-PrivateTemporaryDirectory -Path $secretDirectory
    }

    & gh secret set CHANNEL_PREANALYSIS_CONTEXT_TOKEN `
        --repo $Repository `
        --body $contextToken
    if ($LASTEXITCODE -ne 0) {
        throw "The GitHub preanalysis token could not be registered."
    }
    & gh secret set CHANNEL_PREANALYSIS_CONTEXT_PROXY_URL `
        --repo $Repository `
        --body $ContextEndpoint
    if ($LASTEXITCODE -ne 0) {
        throw "The GitHub preanalysis Worker URL could not be registered."
    }

    $client = [Net.Http.HttpClient]::new()
    $probeStatus = $null
    try {
        foreach ($delayMs in @(0, 500, 1000, 2000, 4000, 8000)) {
            if ($delayMs -gt 0) {
                Start-Sleep -Milliseconds $delayMs
            }
            $probeRequest = [Net.Http.HttpRequestMessage]::new(
                [Net.Http.HttpMethod]::Post,
                $ContextEndpoint
            )
            [void] $probeRequest.Headers.TryAddWithoutValidation(
                "Origin",
                "https://11qaws.github.io"
            )
            [void] $probeRequest.Headers.TryAddWithoutValidation(
                "Authorization",
                "Bearer $contextToken"
            )
            [void] $probeRequest.Headers.TryAddWithoutValidation(
                "X-ExClipper-Preanalysis-Contract",
                "intentional-authentication-probe"
            )
            $probeRequest.Content = [Net.Http.StringContent]::new(
                "{}",
                [Text.Encoding]::UTF8,
                "application/json"
            )
            try {
                $probeResponse = $client.SendAsync(
                    $probeRequest
                ).GetAwaiter().GetResult()
                try {
                    $probeStatus = [int] $probeResponse.StatusCode
                }
                finally {
                    $probeResponse.Dispose()
                }
            }
            finally {
                $probeRequest.Dispose()
            }
            if ($probeStatus -eq 412) {
                break
            }
            if ($probeStatus -notin @(401, 404, 502, 503)) {
                break
            }
        }
        if ($probeStatus -ne 412) {
            throw "The Worker authentication probe returned HTTP $probeStatus."
        }
    }
    finally {
        $client.Dispose()
    }

    if ($UseSavedCredentials) {
        Remove-UserProtectedActivationSecrets
    }
    Write-Host "The preanalysis Worker and GitHub Actions connection are active."
}
finally {
    $groqKey = $null
    $qwenKey = $null
    $contextToken = $null
    $mediaSigningKey = $null
    Pop-Location
}
