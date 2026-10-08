/**
 * audioSiren.js -- Web Audio API Emergency Siren Synthesizer.
 * Generates an emergency warning tone without needing external audio files.
 */

class AudioSiren {
  constructor() {
    this.ctx = null
    this.osc1 = null
    this.osc2 = null
    this.gainNode = null
    this.isPlaying = false
    this.lfo = null
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      this.ctx = new AudioCtx()
    }
  }

  playSiren() {
    if (this.isPlaying) return
    this.init()

    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }

    // Create Main Oscillators
    this.osc1 = this.ctx.createOscillator()
    this.osc2 = this.ctx.createOscillator()
    this.gainNode = this.ctx.createGain()

    this.osc1.type = 'sawtooth'
    this.osc2.type = 'sine'

    // LFO for pitch modulation (warbling sound)
    this.lfo = this.ctx.createOscillator()
    const lfoGain = this.ctx.createGain()
    this.lfo.frequency.value = 2.5 // 2.5 Hz warble
    lfoGain.gain.value = 250 // pitch sweep range

    this.lfo.connect(lfoGain)
    lfoGain.connect(this.osc1.frequency)
    lfoGain.connect(this.osc2.frequency)

    this.osc1.frequency.value = 650
    this.osc2.frequency.value = 655

    this.gainNode.gain.setValueAtTime(0.08, this.ctx.currentTime)

    this.osc1.connect(this.gainNode)
    this.osc2.connect(this.gainNode)
    this.gainNode.connect(this.ctx.destination)

    this.lfo.start()
    this.osc1.start()
    this.osc2.start()
    this.isPlaying = true
  }

  stopSiren() {
    if (!this.isPlaying) return
    try {
      if (this.osc1) this.osc1.stop()
      if (this.osc2) this.osc2.stop()
      if (this.lfo) this.lfo.stop()
    } catch { /* ignore */ }
    this.isPlaying = false
  }
}

export const sirenManager = new AudioSiren()
