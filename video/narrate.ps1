param(
    [Parameter(Mandatory = $true)][string]$Storyboard,
    [Parameter(Mandatory = $true)][string]$AudioDirectory,
    [int]$Rate = 0
)
$ErrorActionPreference = 'Stop'
$taskStory = Get-Content -LiteralPath $Storyboard -Raw -Encoding UTF8 | ConvertFrom-Json
$taskVoice = New-Object -ComObject SAPI.SpVoice
$taskToken = @($taskVoice.GetVoices() | Where-Object { $_.GetDescription() -eq $taskStory.voice })
if ($taskToken.Count -ne 1) { throw 'The exact configured SAPI voice was not found.' }
$taskVoice.Voice = $taskToken[0]
$taskVoice.Rate = $Rate
$taskVoice.Volume = 100
[System.IO.Directory]::CreateDirectory($AudioDirectory) | Out-Null
$taskInfo = @()
foreach ($taskScene in $taskStory.scenes) {
    $taskIndex = 0
    foreach ($taskSentence in $taskScene.sentences) {
        $taskIndex++
        $taskFile = Join-Path $AudioDirectory ('{0}-{1:00}.wav' -f $taskScene.id, $taskIndex)
        $taskStream = New-Object -ComObject SAPI.SpFileStream
        $taskStream.Format.Type = 22
        try {
            $taskStream.Open($taskFile, 3, $false)
            $taskVoice.AudioOutputStream = $taskStream
            [void]$taskVoice.Speak([string]$taskSentence, 0)
        }
        finally { $taskStream.Close() }
        $taskInfo += [PSCustomObject]@{ scene = $taskScene.id; sentence = $taskIndex; file = $taskFile }
    }
}
[PSCustomObject]@{
    voice = $taskToken[0].GetDescription()
    rate = $Rate
    audio_format = 'PCM 22050 Hz 16-bit mono'
    generated = $taskInfo
} | ConvertTo-Json -Depth 5
