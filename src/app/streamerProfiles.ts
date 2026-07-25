/**
 * Profile pictures for the cast, keyed by the display name the analysis uses.
 *
 * The files live in `public/`, which Vite copies verbatim — it does not rewrite
 * URLs inside them or for them. So the deploy base has to be applied here, or
 * the images 404 wherever the app is not served from the domain root (the
 * GitHub Pages case, `/exclipper/`). That is the same failure the fonts had.
 */
const BASE = import.meta.env.BASE_URL;

/** 이름은 `participantRoster` 의 `displayName` 과 정확히 일치해야 한다. */
const PROFILE_FILE_BY_NAME: Readonly<Record<string, string>> = {
  아모레또: "amoretto.jpg",
  유레카: "eureka.png",
  "세나 아르벨": "sena.png",
  "토로리 코코": "torori.png",
  망징이: "mangjing.png",
};

/**
 * 이름 → 프로필 이미지 URL. 사진이 없는 인물(예: 진행자)은 빠지며, 화면은
 * 이니셜로 대신 그린다.
 */
export const STREAMER_PROFILE_IMAGE_BY_NAME: Readonly<
  Record<string, string | undefined>
> = Object.fromEntries(
  Object.entries(PROFILE_FILE_BY_NAME).map(([name, file]) => [
    name,
    `${BASE}streamers/${file}`,
  ]),
);

export function streamerProfileImage(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  return STREAMER_PROFILE_IMAGE_BY_NAME[name];
}
