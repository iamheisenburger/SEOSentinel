import { AbsoluteFill } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Fragment } from "react";
import { sceneFrames, TRANSITION_FRAMES, type AnswerVideoProps } from "./types";
import { Background, BrandMark, Progress } from "./parts";
import { Scene } from "./scenes";

/** One answer video: the scenes in order, dissolving into each other over a living background, with the brand and a
 * progress bar on top. Each scene lasts as long as its own voice. */
export function AnswerVideo({ brand, screenshotSrc, scenes }: AnswerVideoProps) {
  return (
    <AbsoluteFill>
      <Background accent={brand.accent} />
      <TransitionSeries>
        {scenes.map((scene, i) => (
          <Fragment key={i}>
            {i > 0 && <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />}
            <TransitionSeries.Sequence name={`${i + 1}. ${scene.kind}`} durationInFrames={sceneFrames(scene)}>
              <Scene scene={scene} brand={brand} screenshotSrc={screenshotSrc} />
            </TransitionSeries.Sequence>
          </Fragment>
        ))}
      </TransitionSeries>
      <BrandMark name={brand.name} accent={brand.accent} />
      <Progress accent={brand.accent} />
    </AbsoluteFill>
  );
}
