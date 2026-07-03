import { useEffect, useRef } from 'react'

/**
 * Динамичный фон: зацикленное видео, приглушённое под тёмно-серую тему.
 * Стеклянные панели (backdrop-filter) размывают его — живой liquid glass.
 * Если видео не загрузилось/запрещён автоплей — остаются CSS-блобы.
 *
 * Эффекты:
 * - параллакс: при скролле видео смещается медленнее контента;
 * - «дыхание»: событие window 'bg-pulse' (появление гипотез) на время
 *   поднимает яркость свечения.
 */
export default function Background() {
  const videoRef = useRef(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    // некоторые браузеры блокируют autoplay до первого взаимодействия
    const tryPlay = () => v.play().catch(() => {})
    tryPlay()
    window.addEventListener('pointerdown', tryPlay, { once: true })

    // параллакс: смещение ~7% от прокрутки, через rAF без layout-трэшинга
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const y = Math.min(window.scrollY * 0.07, 120)
        v.style.transform = `translate3d(0, ${-y}px, 0) scale(1.16)`
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    // «дыхание» яркости по событию (генерация гипотез и т.п.)
    let pulseTimer = 0
    const onPulse = () => {
      v.classList.remove('pulsing')
      // перезапуск CSS-анимации, если пульс пришёл во время предыдущего
      void v.offsetWidth
      v.classList.add('pulsing')
      clearTimeout(pulseTimer)
      pulseTimer = setTimeout(() => v.classList.remove('pulsing'), 2600)
    }
    window.addEventListener('bg-pulse', onPulse)

    return () => {
      window.removeEventListener('pointerdown', tryPlay)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('bg-pulse', onPulse)
      if (raf) cancelAnimationFrame(raf)
      clearTimeout(pulseTimer)
    }
  }, [])

  return (
    <>
      <div className="bg-scene">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
        <video
          ref={videoRef}
          className="bg-video"
          src="/bg.mp4"
          autoPlay
          muted
          loop
          playsInline
          disablePictureInPicture
          aria-hidden="true"
        />
        <div className="bg-veil" />
      </div>
      <div className="bg-noise" />
    </>
  )
}
