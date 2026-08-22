const MAX_EXPLICIT_DEVICES = 8

const DEFAULT_AUDIO = {
  echoCancellation: true,
  noiseSuppression: true
} as const

type CaptureConstraints = MediaStreamConstraints

export interface MicrophoneCaptureDiagnostics {
  attempt: 'default' | 'explicit'
  inputCount: number
  explicitIndex?: number
}

export interface MicrophoneCaptureOptions {
  onAttempt?: (diagnostics: MicrophoneCaptureDiagnostics) => void
}

function constraints(deviceId?: string): CaptureConstraints {
  return {
    audio: deviceId
      ? { deviceId: { exact: deviceId }, ...DEFAULT_AUDIO }
      : DEFAULT_AUDIO,
    video: false
  }
}

/**
 * Open a microphone despite Chromium choosing a broken Windows default input.
 * The default remains the fast path; explicit probing is bounded and only runs
 * after that path fails.
 */
export async function openMicrophoneStream(
  mediaDevices: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'> = navigator.mediaDevices,
  options: MicrophoneCaptureOptions = {}
): Promise<MediaStream> {
  let lastError: unknown

  const reportAttempt = (diagnostics: MicrophoneCaptureDiagnostics) => {
    if (import.meta.env.DEV) {
      console.debug('[mic-capture]', diagnostics)
    }

    options.onAttempt?.(diagnostics)
  }

  try {
    reportAttempt({ attempt: 'default', inputCount: 0 })

    return await mediaDevices.getUserMedia(constraints())
  } catch (error) {
    lastError = error
  }

  let inputs: MediaDeviceInfo[]

  try {
    inputs = (await mediaDevices.enumerateDevices()).filter(
      device => device.kind === 'audioinput' && device.deviceId
    )
  } catch {
    throw lastError
  }

  const deviceIds = [...new Set(inputs.map(device => device.deviceId))].slice(0, MAX_EXPLICIT_DEVICES)

  for (const [index, deviceId] of deviceIds.entries()) {
    try {
      reportAttempt({ attempt: 'explicit', inputCount: inputs.length, explicitIndex: index })

      return await mediaDevices.getUserMedia(constraints(deviceId))
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}
