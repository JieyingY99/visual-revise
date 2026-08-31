import styles from './Hero.module.css'

export function Hero() {
  return (
    <main className={styles.hero}>
      <p className={styles.heroEyebrow}>Mathematical Curve Motion</p>
      <h1 className={styles.heroTitle}>A Gallery of Mathematical Loading Animations</h1>
      <div className={styles.heroBar}>
        <button className={`${styles.btn} ${styles.btnPrimary}`}>Get started</button>
        <button className={styles.btn}>Documentation</button>
      </div>
    </main>
  )
}
