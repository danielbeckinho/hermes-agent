import { describe, expect, it, vi } from 'vitest'

import { openMicrophoneStream } from './mic-capture'

function stream(id: string) {
  return { id } as unknown as MediaStream
}

describe('openMicrophoneStream', () => {
  it('keeps the default-device path as the fast path', async () => {
    const defaultStream = stream('default')
    const getUserMedia = vi.fn().mockResolvedValue(defaultStream)
    const mediaDevices = { getUserMedia, enumerateDevices: vi.fn() } as unknown as MediaDevices

    await expect(openMicrophoneStream(mediaDevices)).resolves.toBe(defaultStream)

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false
    })
  })

  it('tries an explicit input when Chromium rejects the default device', async () => {
    const physicalStream = stream('physical')

    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('in use', 'NotReadableError'))
      .mockResolvedValueOnce(physicalStream)

    const enumerateDevices = vi.fn().mockResolvedValue([
      { kind: 'audioinput', deviceId: 'physical' },
      { kind: 'videoinput', deviceId: 'camera' }
    ])

    const mediaDevices = { getUserMedia, enumerateDevices } as unknown as MediaDevices

    await expect(openMicrophoneStream(mediaDevices)).resolves.toBe(physicalStream)

    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: { deviceId: { exact: 'physical' }, echoCancellation: true, noiseSuppression: true },
      video: false
    })
  })

  it('reports the final capture error and bounds device probing', async () => {
    const error = new DOMException('in use', 'NotReadableError')
    const getUserMedia = vi.fn().mockRejectedValue(error)

    const enumerateDevices = vi.fn().mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ kind: 'audioinput', deviceId: `mic-${i}` }))
    )

    const mediaDevices = { getUserMedia, enumerateDevices } as unknown as MediaDevices

    await expect(openMicrophoneStream(mediaDevices)).rejects.toBe(error)

    expect(getUserMedia).toHaveBeenCalledTimes(9)
  })
})
