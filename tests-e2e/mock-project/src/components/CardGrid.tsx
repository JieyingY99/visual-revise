import styles from './CardGrid.module.css'

const CARDS = [
  { title: 'Original Thinking', tag: 'Custom Rose Trail',
    body: 'The base circle is carved by a sevenfold cosine term.' },
  { title: 'Thinking Five', tag: 'Custom Rose Trail',
    body: 'Replacing the sevenfold term with a fivefold term reduces the inner loops.' },
  { title: 'Thinking Nine', tag: 'Custom Rose Trail',
    body: 'A ninefold term packs more inner turns into the same orbit.' },
]

export function CardGrid() {
  return (
    <section className={styles.cards}>
      {CARDS.map(card => (
        <article key={card.title} className={styles.curveCard}>
          <div className={styles.swatch} />
          <h2 className={styles.cardTitle}>{card.title}</h2>
          <span className={styles.cardTag}>{card.tag}</span>
          <p className={styles.cardBody}>{card.body}</p>
        </article>
      ))}
    </section>
  )
}
