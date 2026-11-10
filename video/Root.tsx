import { Composition, type CalculateMetadataFunction } from "remotion";
import { AnswerVideo } from "./AnswerVideo";
import { FPS, totalFrames, type AnswerVideoProps } from "./types";

const sample: AnswerVideoProps = {
  brand: { name: "Example", domain: "example.com", accent: "#3DA5F5" },
  screenshotSrc: null,
  scenes: [
    { kind: "hook", heading: "How do I find my first clients?", items: [], emphasis: ["clients"], audioSrc: null, audioMs: 3000,
      narration: "How do I find my first clients? Here is the short answer." },
    { kind: "steps", heading: "Three steps", items: ["Pick one niche", "Find a visible problem", "Write about that problem"], emphasis: [],
      audioSrc: null, audioMs: 6000, narration: "Pick one niche. Find a visible problem. Then write about that problem." },
    { kind: "cta", heading: "Start with one list.", items: [], emphasis: [], audioSrc: null, audioMs: 2500, narration: "Start with one list." },
  ],
};

const calculateMetadata: CalculateMetadataFunction<AnswerVideoProps> = ({ props }) => ({ durationInFrames: totalFrames(props.scenes, FPS) });

export function RemotionRoot() {
  return (
    <>
      <Composition id="AnswerVideo" component={AnswerVideo} fps={FPS} width={1920} height={1080} durationInFrames={300} defaultProps={sample}
        calculateMetadata={calculateMetadata} />
      <Composition id="AnswerVideoVertical" component={AnswerVideo} fps={FPS} width={1080} height={1920} durationInFrames={300} defaultProps={sample}
        calculateMetadata={calculateMetadata} />
    </>
  );
}
