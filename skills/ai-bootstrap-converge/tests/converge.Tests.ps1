BeforeAll {
    $SkillRoot = Split-Path -Parent $PSScriptRoot
$ConvergeScript = Join-Path $SkillRoot 'scripts/converge.ps1'
$ConvergeShellScript = Join-Path $SkillRoot 'scripts/converge.sh'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $SkillRoot)
$TestRoot = Join-Path $RepoRoot 'tmp/ai/skill-tests'

function New-TestCaseRoot {
    New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
    return (Join-Path $TestRoot ("case-" + [guid]::NewGuid().ToString('N')))
}

function Get-TestSh {
    if ($env:AI_BOOTSTRAP_TEST_SH -and (Test-Path -LiteralPath $env:AI_BOOTSTRAP_TEST_SH -PathType Leaf)) {
        return $env:AI_BOOTSTRAP_TEST_SH
    }
    $gitSh = 'C:\Program Files\Git\usr\bin\sh.exe'
    if (Test-Path -LiteralPath $gitSh -PathType Leaf) {
        return $gitSh
    }
    $cmd = Get-Command sh -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Convert-ToShPath {
    param(
        [string]$Sh,
        [string]$Path
    )
    $shDir = Split-Path -Parent $Sh
    $cygpath = Join-Path $shDir 'cygpath.exe'
    if (Test-Path -LiteralPath $cygpath -PathType Leaf) {
        return (& $cygpath -u $Path).Trim()
    }
    return $Path
}

function New-TestSymlink {
    param(
        [string]$Target,
        [string]$Link
    )
    try {
        New-Item -ItemType SymbolicLink -Path $Link -Target $Target -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Invoke-ConvergeShell {
    param(
        [string]$Mode,
        [string]$Target,
        [string]$Template,
        [switch]$Json
    )
    $sh = Get-TestSh
    if (-not $sh) { return $null }

    $oldPath = $env:PATH
    try {
        $separator = [IO.Path]::PathSeparator
        $env:PATH = "$(Split-Path -Parent $sh)$separator$oldPath"
        $scriptPath = Convert-ToShPath $sh $ConvergeShellScript
        $targetPath = Convert-ToShPath $sh $Target
        $templatePath = Convert-ToShPath $sh $Template
        $args = @('--mode', $Mode, '--target', $targetPath, '--template', $templatePath)
        if ($Json) { $args += '--json' }
        $output = & $sh $scriptPath @args 2>&1
        $exitCode = $LASTEXITCODE
        return [pscustomobject]@{
            Output = @($output)
            ExitCode = $exitCode
        }
    } finally {
        $env:PATH = $oldPath
    }
}

function New-TestTemplate {
    param([string]$Root)
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'local/ai/agents') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'local/ai/scripts') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'local/ai/codex') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'skills/ai-bootstrap-converge') | Out-Null
    Set-Content -LiteralPath (Join-Path $Root 'AGENTS.md') -Value 'template agents' -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $Root 'README_snippet.md') -Value '<!-- ai-bootstrap -->' -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $Root 'local/ai/agents/01-bootstrap.md') -Value 'bootstrap module' -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $Root 'local/ai/scripts/init.ps1') -Value 'Write-Output init' -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $Root 'local/ai/chat_context.md') -Value 'template chat context' -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $Root 'local/ai/codex/requests.log') -Value '{"timestamp":"YYYY-MM-DDTHH:MM:SSZ"}' -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $Root 'skills/ai-bootstrap-converge/SKILL.md') -Value 'canonical skill' -Encoding utf8NoBOM
    @'
# BEGIN EXCLUDE LIST (for .git/info/exclude)
# AGENTS.md
# local/ai/
# tmp/ai/
# END EXCLUDE LIST
'@ | Set-Content -LiteralPath (Join-Path $Root '.gitignore') -Encoding utf8NoBOM
}
}

Describe 'ai-bootstrap-converge converge.ps1' {
    It 'plans missing framework files without writing in Plan mode' {
        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        New-Item -ItemType Directory -Force -Path $template, $target | Out-Null
        try {
            New-TestTemplate $template
            Set-Content -LiteralPath (Join-Path $target 'README.md') -Value '# Project' -Encoding utf8NoBOM

            $json = & pwsh -NoProfile -File $ConvergeScript -Mode Plan -Target $target -Template $template -Json
            $LASTEXITCODE | Should -Be 0
            $ops = $json | ConvertFrom-Json
            @($ops | Where-Object Path -eq 'AGENTS.md' | Where-Object Status -eq 'MISSING').Count | Should -Be 1
            Test-Path -LiteralPath (Join-Path $target 'AGENTS.md') | Should -Be $false
            @($ops | Where-Object Path -eq 'skills/ai-bootstrap-converge/SKILL.md' | Where-Object Status -eq 'MISSING').Count | Should -Be 1
            @($ops | Where-Object Path -eq '.agents/skills/ai-bootstrap-converge' | Where-Object Type -eq 'EnsureSkillDiscoveryLink').Count | Should -Be 1
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'applies safe framework operations while preserving existing local context' {
        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        New-Item -ItemType Directory -Force -Path $template, $target | Out-Null
        try {
            New-TestTemplate $template
            git -C $target init | Out-Null
            New-Item -ItemType Directory -Force -Path (Join-Path $target 'local/ai') | Out-Null
            Set-Content -LiteralPath (Join-Path $target 'local/ai/chat_context.md') -Value 'project context' -Encoding utf8NoBOM
            Set-Content -LiteralPath (Join-Path $target 'README.md') -Value '# Project' -Encoding utf8NoBOM

            $json = & pwsh -NoProfile -File $ConvergeScript -Mode Apply -Target $target -Template $template -Json
            $exitCode = $LASTEXITCODE
            ((0, 2) -contains $exitCode) | Should -Be $true
            $ops = $json | ConvertFrom-Json

            (Get-Content -Raw -LiteralPath (Join-Path $target 'local/ai/chat_context.md')).Trim() | Should -Be 'project context'
            Get-Content -Raw -LiteralPath (Join-Path $target 'README.md') | Should -Match '<!-- ai-bootstrap -->'
            (@(Get-Content -LiteralPath (Join-Path $target '.git/info/exclude')) -contains 'tmp/ai/') | Should -Be $true
            Test-Path -LiteralPath (Join-Path $target '.github/copilot-instructions.md') | Should -Be $true
            Test-Path -LiteralPath (Join-Path $target 'skills/ai-bootstrap-converge/SKILL.md') | Should -Be $true
            if ($exitCode -eq 0) {
                (Get-Item -LiteralPath (Join-Path $target '.agents/skills/ai-bootstrap-converge') -Force).LinkType | Should -Be 'SymbolicLink'
                (Get-Item -LiteralPath (Join-Path $target '.claude/skills/ai-bootstrap-converge') -Force).LinkType | Should -Be 'SymbolicLink'
            } else {
                (@($ops | Where-Object Type -eq 'EnsureSkillDiscoveryLink' | Where-Object Status -eq 'BLOCKED').Count -gt 0) | Should -Be $true
            }
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'reports conflict instead of overwriting existing managed file' {
        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        New-Item -ItemType Directory -Force -Path $template, $target | Out-Null
        try {
            New-TestTemplate $template
            Set-Content -LiteralPath (Join-Path $target 'README_snippet.md') -Value 'custom snippet' -Encoding utf8NoBOM

            $json = & pwsh -NoProfile -File $ConvergeScript -Mode Plan -Target $target -Template $template -Json
            $ops = $json | ConvertFrom-Json
            @($ops | Where-Object Path -eq 'README_snippet.md' | Where-Object Status -eq 'CONFLICT').Count | Should -Be 1
            (Get-Content -Raw -LiteralPath (Join-Path $target 'README_snippet.md')).Trim() | Should -Be 'custom snippet'
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'plans AGENTS.md convergence as a safe patch over project rules' {
        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        New-Item -ItemType Directory -Force -Path $template, $target | Out-Null
        try {
            New-TestTemplate $template
            Set-Content -LiteralPath (Join-Path $target 'AGENTS.md') -Value @'
# Project agent rules

- Keep WARPinator-specific rules.
'@ -Encoding utf8NoBOM

            $json = & pwsh -NoProfile -File $ConvergeScript -Mode Plan -Target $target -Template $template -Json
            $LASTEXITCODE | Should -Be 0
            $ops = $json | ConvertFrom-Json
            $agentOp = @($ops | Where-Object Path -eq 'AGENTS.md' | Where-Object Type -eq 'EnsureAgentsInstructions')
            $agentOp.Count | Should -Be 1
            $agentOp[0].Status | Should -Be 'MISSING'
            $agentOp[0].Safe | Should -Be $true
            $agentOp[0].Detail | Should -Match 'preserving existing project rules'
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'applies AGENTS.md convergence without dropping project rules' {
        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        New-Item -ItemType Directory -Force -Path $template, $target | Out-Null
        try {
            New-TestTemplate $template
            Set-Content -LiteralPath (Join-Path $target 'AGENTS.md') -Value @'
# Project agent rules

- Keep WARPinator-specific rules.
'@ -Encoding utf8NoBOM

            $json = & pwsh -NoProfile -File $ConvergeScript -Mode Apply -Target $target -Template $template -Json
            ((0, 2) -contains $LASTEXITCODE) | Should -Be $true
            $ops = $json | ConvertFrom-Json
            @($ops | Where-Object Path -eq 'AGENTS.md' | Where-Object Type -eq 'EnsureAgentsInstructions' | Where-Object Safe -eq $true).Count | Should -Be 1
            $text = Get-Content -Raw -LiteralPath (Join-Path $target 'AGENTS.md')
            $text | Should -Match 'template agents'
            $text | Should -Match 'Keep WARPinator-specific rules'
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'uses portable relative path calculation' {
        $source = Get-Content -Raw -LiteralPath $ConvergeScript
        $source | Should -Not -Match 'MakeRelativeUri'
        $source | Should -Match 'GetRelativePath'
    }

    It 'reports tracked local-only files as explicit user decisions' {
        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        New-Item -ItemType Directory -Force -Path $template, $target | Out-Null
        try {
            New-TestTemplate $template
            git -C $target init | Out-Null
            Set-Content -LiteralPath (Join-Path $target 'AGENTS.override.md') -Value 'local override' -Encoding utf8NoBOM
            git -C $target add AGENTS.override.md | Out-Null

            $json = & pwsh -NoProfile -File $ConvergeScript -Mode Plan -Target $target -Template $template -Json
            $LASTEXITCODE | Should -Be 0
            $ops = $json | ConvertFrom-Json
            $tracked = @($ops | Where-Object Type -eq 'ReportLocalOnlyTracked' | Where-Object Path -eq 'AGENTS.override.md')
            $tracked.Count | Should -Be 1
            $tracked[0].Status | Should -Be 'NEEDS_DECISION'
            $tracked[0].Safe | Should -Be $false
            $tracked[0].Detail | Should -Match 'explicit user approval'
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

Describe 'ai-bootstrap-converge converge.sh' {
    It 'keeps audit and plan alive when safe operations are missing' {
        $sh = Get-TestSh
        if (-not $sh) {
            Set-ItResult -Skipped -Because 'No POSIX sh is available in this environment.'
            return
        }

        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        New-Item -ItemType Directory -Force -Path $template, $target | Out-Null
        try {
            New-TestTemplate $template
            Set-Content -LiteralPath (Join-Path $target 'README.md') -Value '# Project' -Encoding utf8NoBOM
            $oldPath = $env:PATH
            $shDir = Split-Path -Parent $sh
            try {
                $env:PATH = "$shDir;$oldPath"
                $scriptPath = Convert-ToShPath $sh $ConvergeShellScript
                $targetPath = Convert-ToShPath $sh $target
                $templatePath = Convert-ToShPath $sh $template
                foreach ($mode in @('audit', 'plan')) {
                    $output = & $sh $scriptPath --mode $mode --target $targetPath --template $templatePath 2>&1
                    $LASTEXITCODE | Should -Be 0
                    ($output -join "`n") | Should -Match 'EnsureSnippetPresent'
                }
            } finally {
                $env:PATH = $oldPath
            }
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'applies AGENTS.md convergence without aborting on link fallback' {
        $sh = Get-TestSh
        if (-not $sh) {
            Set-ItResult -Skipped -Because 'No POSIX sh is available in this environment.'
            return
        }

        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        New-Item -ItemType Directory -Force -Path $template, $target | Out-Null
        try {
            New-TestTemplate $template
            Set-Content -LiteralPath (Join-Path $target 'AGENTS.md') -Value @'
# Project agent rules

- Keep WARPinator-specific rules.
'@ -Encoding utf8NoBOM
            $oldPath = $env:PATH
            $shDir = Split-Path -Parent $sh
            try {
                $env:PATH = "$shDir;$oldPath"
                $scriptPath = Convert-ToShPath $sh $ConvergeShellScript
                $targetPath = Convert-ToShPath $sh $target
                $templatePath = Convert-ToShPath $sh $template
                $rootReadmeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RepoRoot 'README.md')).Hash
                $null = & $sh $scriptPath --mode apply --target $targetPath --template $templatePath --json 2>&1
                ((0, 2) -contains $LASTEXITCODE) | Should -Be $true
                Test-Path -LiteralPath (Join-Path $target 'README.md') | Should -Be $true
                (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RepoRoot 'README.md')).Hash | Should -Be $rootReadmeHash
                Test-Path -LiteralPath (Join-Path $SkillRoot 'ai-bootstrap-converge') | Should -Be $false
                $text = Get-Content -Raw -LiteralPath (Join-Path $target 'AGENTS.md')
                $text | Should -Match 'template agents'
                $text | Should -Match 'Keep WARPinator-specific rules'
            } finally {
                $env:PATH = $oldPath
            }
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'rejects a symlinked template AGENTS.md before Apply can copy it' {
        $sh = Get-TestSh
        if (-not $sh) {
            Set-ItResult -Skipped -Because 'No POSIX sh is available in this environment.'
            return
        }

        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        $outside = Join-Path $case 'outside'
        New-Item -ItemType Directory -Force -Path $template, $target, $outside | Out-Null
        try {
            New-TestTemplate $template
            $outsideAgents = Join-Path $outside 'AGENTS.md'
            Set-Content -LiteralPath $outsideAgents -Value 'synthetic external template data' -Encoding utf8NoBOM
            Remove-Item -LiteralPath (Join-Path $template 'AGENTS.md') -Force
            (New-TestSymlink $outsideAgents (Join-Path $template 'AGENTS.md')) | Should -Be $true
            Set-Content -LiteralPath (Join-Path $target 'README.md') -Value '# Project' -Encoding utf8NoBOM

            $result = Invoke-ConvergeShell -Mode apply -Target $target -Template $template -Json
            $result.ExitCode | Should -Not -Be 0
            Test-Path -LiteralPath (Join-Path $target 'AGENTS.md') | Should -Be $false
            ($result.Output -join "`n") | Should -Match 'regular non-symlink file'
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'rejects a symlinked template README_snippet.md before Apply can dereference it' {
        $sh = Get-TestSh
        if (-not $sh) {
            Set-ItResult -Skipped -Because 'No POSIX sh is available in this environment.'
            return
        }

        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        $outside = Join-Path $case 'outside'
        New-Item -ItemType Directory -Force -Path $template, $target, $outside | Out-Null
        try {
            New-TestTemplate $template
            $outsideSnippet = Join-Path $outside 'README_snippet.md'
            Set-Content -LiteralPath $outsideSnippet -Value 'synthetic external snippet data' -Encoding utf8NoBOM
            Remove-Item -LiteralPath (Join-Path $template 'README_snippet.md') -Force
            (New-TestSymlink $outsideSnippet (Join-Path $template 'README_snippet.md')) | Should -Be $true
            Set-Content -LiteralPath (Join-Path $target 'README.md') -Value '# Project' -Encoding utf8NoBOM

            $result = Invoke-ConvergeShell -Mode apply -Target $target -Template $template -Json
            $result.ExitCode | Should -Not -Be 0
            (Get-Content -Raw -LiteralPath (Join-Path $target 'README.md')).Trim() | Should -Be '# Project'
            ($result.Output -join "`n") | Should -Match 'regular non-symlink file'
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'blocks Apply when a target descendant symlink would redirect a managed write' {
        $sh = Get-TestSh
        if (-not $sh) {
            Set-ItResult -Skipped -Because 'No POSIX sh is available in this environment.'
            return
        }

        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        $outside = Join-Path $case 'outside'
        New-Item -ItemType Directory -Force -Path $template, $target, $outside | Out-Null
        try {
            New-TestTemplate $template
            (New-TestSymlink $outside (Join-Path $target 'local')) | Should -Be $true

            $result = Invoke-ConvergeShell -Mode apply -Target $target -Template $template -Json
            $result.ExitCode | Should -Be 2
            Test-Path -LiteralPath (Join-Path $outside 'ai/chat_context.md') | Should -Be $false
            $ops = $result.Output -join "`n" | ConvertFrom-Json
            @($ops | Where-Object { $_.Type -eq 'EnsureIfMissing' -and $_.Path -eq 'local/ai/chat_context.md' -and $_.Status -eq 'BLOCKED' }).Count | Should -Be 1
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'rejects an instruction symlink with an arbitrary AGENTS.md suffix' {
        $sh = Get-TestSh
        if (-not $sh) {
            Set-ItResult -Skipped -Because 'No POSIX sh is available in this environment.'
            return
        }

        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        New-Item -ItemType Directory -Force -Path $template, $target, (Join-Path $target '.github'), (Join-Path $target 'nested') | Out-Null
        try {
            New-TestTemplate $template
            Set-Content -LiteralPath (Join-Path $target 'AGENTS.md') -Value 'canonical agents' -Encoding utf8NoBOM
            Set-Content -LiteralPath (Join-Path $target 'nested/AGENTS.md') -Value 'synthetic alternate instructions' -Encoding utf8NoBOM
            (New-TestSymlink '../nested/AGENTS.md' (Join-Path $target '.github/copilot-instructions.md')) | Should -Be $true

            $result = Invoke-ConvergeShell -Mode audit -Target $target -Template $template -Json
            $result.ExitCode | Should -Be 0
            $ops = $result.Output -join "`n" | ConvertFrom-Json
            $op = @($ops | Where-Object { $_.Type -eq 'EnsureInstructionLink' -and $_.Path -eq '.github/copilot-instructions.md' })
            $op.Count | Should -Be 1
            $op[0].Status | Should -Be 'CONFLICT'
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'rejects a skill discovery symlink with an arbitrary skills suffix' {
        $sh = Get-TestSh
        if (-not $sh) {
            Set-ItResult -Skipped -Because 'No POSIX sh is available in this environment.'
            return
        }

        $case = New-TestCaseRoot
        $template = Join-Path $case 'template'
        $target = Join-Path $case 'target'
        New-Item -ItemType Directory -Force -Path $template, $target, (Join-Path $target '.agents/skills'), (Join-Path $target 'other/skills/ai-bootstrap-converge') | Out-Null
        try {
            New-TestTemplate $template
            (New-TestSymlink '../../other/skills/ai-bootstrap-converge' (Join-Path $target '.agents/skills/ai-bootstrap-converge')) | Should -Be $true

            $result = Invoke-ConvergeShell -Mode audit -Target $target -Template $template -Json
            $result.ExitCode | Should -Be 0
            $ops = $result.Output -join "`n" | ConvertFrom-Json
            $op = @($ops | Where-Object { $_.Type -eq 'EnsureSkillDiscoveryLink' -and $_.Path -eq '.agents/skills/ai-bootstrap-converge' })
            $op.Count | Should -Be 1
            $op[0].Status | Should -Be 'CONFLICT'
        } finally {
            Remove-Item -LiteralPath $case -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
