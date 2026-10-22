!macro NSIS_HOOK_POSTINSTALL
  ; Install Ollama for the current user when it is not already available.
  ; The model itself is downloaded on first launch so Setup stays lightweight.
  IfFileExists "$LOCALAPPDATA\Programs\Ollama\ollama.exe" ollama_done 0
  DetailPrint "Downloading the official Ollama installer..."
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri https://ollama.com/download/OllamaSetup.exe -OutFile $env:TEMP\VECTOR-AI-OllamaSetup.exe; exit 0 } catch { exit 1 }"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 ollama_download_failed
  DetailPrint "Starting Ollama installer..."
  ExecWait '"$TEMP\VECTOR-AI-OllamaSetup.exe"' $0
  Delete "$TEMP\VECTOR-AI-OllamaSetup.exe"
  Goto ollama_done
ollama_download_failed:
  DetailPrint "Ollama download was skipped. VECTOR AI will retry on first launch."
ollama_done:
!macroend
