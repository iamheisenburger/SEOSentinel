import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import { audioFrames, LEAD_FRAMES, timedCaptions, type AnswerVideoProps, type VideoScene } from "./types";
import { asset, BrowserFrame, Captions, fontFamily, INK, MUTED, Rise, useVertical, WordsIn } from "./parts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type SceneProps = { scene: VideoScene; brand: AnswerVideoProps["brand"]; screenshotSrc: string | null };

/** When each item comes in: spread across the voice, so a list builds while it is being read. */
function itemAt(index: number, count: number, scene: VideoScene, fps: number) {
  const span = audioFrames(scene, fps) * 0.82;
  return LEAD_FRAMES + 10 + Math.round((index / Math.max(1, count)) * span);
}

export function Scene(props: SceneProps) {
  const { scene, brand } = props;
  return (
    <AbsoluteFill>
      {scene.kind === "hook" && <Hook {...props} />}
      {scene.kind === "statement" && <Statement {...props} />}
      {(scene.kind === "steps" || scene.kind === "checklist") && <List {...props} />}
      {scene.kind === "product" && <Product {...props} />}
      {scene.kind === "cta" && <Cta {...props} />}
      {scene.audioSrc && (
        <Sequence name="Voice" from={LEAD_FRAMES} layout="none">
          <Audio src={asset(scene.audioSrc)} />
        </Sequence>
      )}
      <Captions captions={timedCaptions(scene.narration, scene.audioMs)} accent={brand.accent} />
    </AbsoluteFill>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const vertical = useVertical();
  return (
    <AbsoluteFill style={{ padding: vertical ? "260px 80px 420px" : "150px 150px 190px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      {children}
    </AbsoluteFill>
  );
}

function Hook({ scene, brand }: SceneProps) {
  const vertical = useVertical();
  const frame = useCurrentFrame();
  return (
    <Frame>
      <Rise at={0} distance={14}>
        <div style={{ fontFamily, fontSize: vertical ? 34 : 26, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: brand.accent,
          marginBottom: vertical ? 40 : 34 }}>The short answer</div>
      </Rise>
      <WordsIn text={scene.heading} emphasis={scene.emphasis} size={vertical ? 104 : 108} accent={brand.accent} delay={4} />
      <div style={{ marginTop: vertical ? 54 : 46, height: 6, borderRadius: 3, background: brand.accent,
        width: interpolate(frame, [14, 44], [0, vertical ? 260 : 220], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) }) }} />
    </Frame>
  );
}

function Statement({ scene, brand }: SceneProps) {
  const vertical = useVertical();
  const { fps } = useVideoConfig();
  return (
    <Frame>
      <WordsIn text={scene.heading} emphasis={scene.emphasis} size={vertical ? 92 : 88} accent={brand.accent} delay={2} />
      {scene.items.length > 0 && (
        <div style={{ marginTop: 48, display: "flex", flexDirection: vertical ? "column" : "row", gap: 24 }}>
          {scene.items.map((item, i) => (
            <Rise key={item} at={itemAt(i, scene.items.length, scene, fps)} style={{ flex: 1, display: "flex" }}>
              <div style={{ flex: 1, fontFamily, fontSize: vertical ? 44 : 36, fontWeight: 500, color: MUTED, lineHeight: 1.3, padding: "22px 28px", borderRadius: 18,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>{item}</div>
            </Rise>
          ))}
        </div>
      )}
    </Frame>
  );
}

function List({ scene, brand }: SceneProps) {
  const vertical = useVertical();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const steps = scene.kind === "steps";
  const times = scene.items.map((_, i) => itemAt(i, scene.items.length, scene, fps));
  const current = times.reduce((cur, t, i) => (frame >= t ? i : cur), -1);
  return (
    <Frame>
      <WordsIn text={scene.heading} emphasis={scene.emphasis} size={vertical ? 80 : 72} accent={brand.accent} delay={0} />
      <div style={{ marginTop: vertical ? 56 : 44, display: "flex", flexDirection: "column", gap: vertical ? 26 : 20, maxWidth: vertical ? undefined : 1250 }}>
        {scene.items.map((item, i) => {
          const at = times[i];
          const active = i === current;
          return (
            <div key={`${item}-${i}`} style={{ display: "flex", alignItems: "center", gap: 26, padding: vertical ? "26px 30px" : "20px 28px", borderRadius: 20,
              background: active ? "rgba(255,255,255,0.075)" : "rgba(255,255,255,0.035)",
              border: `1px solid ${active ? `${brand.accent}88` : "rgba(255,255,255,0.08)"}`,
              opacity: interpolate(frame, [at, at + 10], [0, 1], clamp),
              translate: interpolate(frame, [at, at + 18], ["80px 0px", "0px 0px"], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) }) }}>
              {steps ? (
                <div style={{ width: vertical ? 64 : 54, height: vertical ? 64 : 54, flexShrink: 0, borderRadius: 16, display: "flex", alignItems: "center",
                  justifyContent: "center", background: active ? brand.accent : "rgba(255,255,255,0.08)", color: active ? "#0A0B0D" : INK, fontFamily,
                  fontWeight: 700, fontSize: vertical ? 32 : 26 }}>{String(i + 1).padStart(2, "0")}</div>
              ) : (
                <Check at={at + 4} color={brand.accent} size={vertical ? 56 : 46} />
              )}
              <div style={{ fontFamily, fontSize: vertical ? 46 : 40, fontWeight: 600, color: active ? INK : "rgba(245,246,247,0.82)", letterSpacing: "-0.015em",
                lineHeight: 1.2 }}>{item}</div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function Check({ at, color, size }: { at: number; color: string; size: number }) {
  const frame = useCurrentFrame();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
      <circle cx="24" cy="24" r="22" fill={`${color}22`} stroke={`${color}66`} strokeWidth="2" />
      <path d="M14 25 L21 32 L35 17" fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray="40" strokeDashoffset={interpolate(frame, [at, at + 14], [40, 0], clamp)} />
    </svg>
  );
}

function Product({ scene, brand, screenshotSrc }: SceneProps) {
  const vertical = useVertical();
  const { fps } = useVideoConfig();
  const text = (
    <div style={{ display: "flex", flexDirection: "column", gap: vertical ? 30 : 26, width: vertical ? "100%" : 640 }}>
      <WordsIn text={scene.heading} emphasis={[...scene.emphasis, brand.name]} size={vertical ? 82 : 68} accent={brand.accent} delay={0} />
      {scene.items.map((item, i) => (
        <Rise key={`${item}-${i}`} at={itemAt(i, scene.items.length, scene, fps)}>
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start", fontFamily, fontSize: vertical ? 42 : 32, fontWeight: 500, color: MUTED, lineHeight: 1.3 }}>
            <div style={{ width: 12, height: 12, borderRadius: 4, background: brand.accent, marginTop: vertical ? 18 : 13, flexShrink: 0 }} />
            {item}
          </div>
        </Rise>
      ))}
    </div>
  );
  if (!screenshotSrc) return <Frame>{text}</Frame>;
  return (
    <AbsoluteFill style={{ padding: vertical ? "250px 80px 420px" : "150px 110px 190px 150px", display: "flex", flexDirection: vertical ? "column" : "row",
      alignItems: vertical ? "stretch" : "center", justifyContent: "space-between", gap: vertical ? 60 : 70 }}>
      {text}
      <BrowserFrame src={screenshotSrc} domain={brand.domain} width={vertical ? 920 : 960} height={vertical ? 700 : 620} at={6} />
    </AbsoluteFill>
  );
}

function Cta({ scene, brand }: SceneProps) {
  const vertical = useVertical();
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center",
      padding: vertical ? "200px 80px 420px" : "120px 160px 200px" }}>
      <div style={{ fontFamily, fontSize: vertical ? 150 : 150, fontWeight: 800, letterSpacing: "-0.05em", color: INK,
        opacity: interpolate(frame, [0, 14], [0, 1], clamp),
        scale: interpolate(frame, [0, 22], [0.9, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) }) }}>{brand.name}</div>
      <WordsIn text={scene.heading} emphasis={scene.emphasis} size={vertical ? 58 : 50} weight={500} color={MUTED} accent={brand.accent} delay={10}
        style={{ justifyContent: "center", marginTop: 24, maxWidth: vertical ? 900 : 1300, lineHeight: 1.25 }} />
      <Rise at={24}>
        <div style={{ marginTop: 56, padding: vertical ? "22px 40px" : "18px 36px", borderRadius: 999, background: brand.accent, color: "#0A0B0D", fontFamily,
          fontWeight: 700, fontSize: vertical ? 48 : 40, letterSpacing: "-0.01em",
          boxShadow: `0 0 ${20 + 14 * Math.sin(frame / 8)}px ${brand.accent}66` }}>{brand.domain}</div>
      </Rise>
    </AbsoluteFill>
  );
}
