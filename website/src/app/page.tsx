import { AgentStrip } from "@/components/Agents";
import { AgentsDetail } from "@/components/AgentsDetail";
import { CaseStudy } from "@/components/CaseStudy";
import { Commands } from "@/components/Commands";
import { Day } from "@/components/Day";
import { Features } from "@/components/Features";
import { FinalCTA, Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Principles } from "@/components/Principles";
import { Shape } from "@/components/Shape";
import { Showcase } from "@/components/Showcase";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <AgentStrip />
        <Shape />
        <Day />
        <Showcase />
        <Features />
        <AgentsDetail />
        <Commands />
        <Principles />
        <CaseStudy />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
