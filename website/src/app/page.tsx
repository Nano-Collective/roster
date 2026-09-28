import { AgentStrip } from "@/components/Agents";
import { AgentsDetail } from "@/components/AgentsDetail";
import { CaseStudy } from "@/components/CaseStudy";
import { Commands } from "@/components/Commands";
import { Day } from "@/components/Day";
import { Features } from "@/components/Features";
import { ForYou } from "@/components/ForYou";
import { FinalCTA, Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Principles } from "@/components/Principles";
import { Shape } from "@/components/Shape";
import { Showcase } from "@/components/Showcase";
import { Work } from "@/components/Work";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <CaseStudy />
        <AgentStrip />
        <Shape />
        <Day />
        <ForYou />
        <Work />
        <Showcase />
        <Features />
        <AgentsDetail />
        <Commands />
        <Principles />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
