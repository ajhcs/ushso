import { ArrowRight, ExternalLink, FileSearch, MessageSquareMore } from 'lucide-react'

const steps = [
  { number: 1, title: 'Ask a question', copy: 'Tell us what you need to know.', Icon: MessageSquareMore },
  { number: 2, title: 'Review matching public sources', copy: 'We find relevant data across trusted sources.', Icon: FileSearch },
  { number: 3, title: 'Open the data', copy: 'Learn how to access and use the data.', Icon: ExternalLink },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="how-it-works" aria-labelledby="how-it-works-title">
      <div className="how-it-works__inner">
        <h2 id="how-it-works-title">How it works</h2>
        <div className="how-it-works__steps">
          {steps.map(({ number, title, copy, Icon }, index) => (
            <div className="how-step-wrap" key={title}>
              <article className="how-step">
                <span className="how-step__number">{number}</span>
                <Icon className="how-step__icon" aria-hidden="true" />
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
              {index < steps.length - 1 && <ArrowRight className="how-step__arrow" aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
