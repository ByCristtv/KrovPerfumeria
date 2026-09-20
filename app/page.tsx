import Hero from "@/components/home/Hero";
import TrustIndicators from "@/components/home/TrustIndicators";
import FeaturedCollection from "@/components/home/FeaturedCollection";
import Identity from "@/components/home/Identity";
import Historia from "@/components/about/Historia";
import Diferenciadores from "@/components/about/Diferenciadores";
import ArteDecant from "@/components/about/ArteDecant";
import ContactMethods from "@/components/contact/ContactMethods";
import FAQAccordion from "@/components/contact/FAQAccordion";
import Reveal from "@/components/ui/Reveal";

// Revalidate the homepage teaser every 5 minutes (ISR) so new arrivals
// surface without a redeploy, while keeping render cost off the request path.
export const revalidate = 300;

/**
 * The storefront is a single narrative page: claim → reassurance → product →
 * meaning → proof → contact.
 *
 * The former /about and /contact routes were folded in here. They each held a
 * single scroll of copy that a visitor had to leave the funnel to read; inlined
 * after the catalogue teaser they answer "who are you?" and "how do I reach
 * you?" at the moment those questions actually arise. The routes now redirect
 * to the matching anchors (see next.config.ts) so indexed links keep working.
 *
 * `Identity` (what KROV actually means) sits AFTER the first look at the
 * catalogue on purpose. A visitor who has just seen something they want is
 * ready to be told why the brand is called what it is; a visitor who is told
 * first is being lectured before they have any reason to care.
 */
export default function Home() {
  return (
    <>
      <Hero />
      <TrustIndicators />
      <FeaturedCollection />
      <Identity />

      <Reveal>
        <Historia />
      </Reveal>
      <Reveal>
        <Diferenciadores />
      </Reveal>
      <Reveal>
        <ArteDecant />
      </Reveal>

      {/*
        The two contact sections were authored for the narrow editorial column
        of /contact and carry no horizontal chrome of their own, so the page
        supplies the gutter and rhythm that route used to.
      */}
      <div className="bg-krov-void">
        <div className="mx-auto max-w-6xl space-y-24 px-5 pb-28 sm:px-8 md:space-y-32 md:pb-36">
          <ContactMethods />
          <FAQAccordion />
        </div>
      </div>
    </>
  );
}
