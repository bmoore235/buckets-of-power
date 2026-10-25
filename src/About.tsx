export default function About() {
  return (
    <section className="about-section" id="about" aria-labelledby="about-title">
      <div className="about-content">
        <p className="eyebrow">A LITTLE CONTEXT</p>
        <h2 id="about-title">About</h2>
        <p>
          This site started with my own desire to analyze left-right balance across a larger dataset than a single ride would allow. My overall balance was within a few percentage points of even, which is pretty normal, but I felt something more was going on. I was able to find that after 2.5 hours, my power balance shifted towards my right side. Since this analysis helped me, I figured it might help others.
        </p>
        <h3>About the AI usage:</h3>
        <p>
          This started with Python code that I wrote about 75% the old-fashioned way. I frankly didn’t have time to build a full website, so I used AI heavily. Right now, everything exists in the browser; you need to download your FIT files and upload them yourself. In the future, I want to tie into other systems. I will still leverage AI for that, but with much more oversight and much less tolerance for “slop”.
        </p>
        <h3>Get in touch:</h3>
        <p>
          If you have ideas for more features or want to get in touch, email me at{" "}
          <a href="mailto:bucketsofpower@gmail.com">bucketsofpower@gmail.com</a>.
        </p>
      </div>
    </section>
  );
}
