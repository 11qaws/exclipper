/**
 * Profile pictures for the cast, keyed by the display name the analysis uses.
 *
 * The files live in `public/`, which Vite copies verbatim — it does not rewrite
 * URLs inside them or for them. So the deploy base has to be applied here, or
 * the images 404 wherever the app is not served from the domain root (the
 * GitHub Pages case, `/exclipper/`). That is the same failure the fonts had.
 */
/**
 * Vite 밖(하네스 생성기 등)에서 이 모듈을 import 하면 `import.meta.env` 가 없다.
 * 초점 데이터만 쓰려는 쪽까지 깨지지 않도록 없으면 루트로 본다.
 */
const BASE = import.meta.env?.BASE_URL ?? "/";

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

/**
 * 잘라 쓸 때 화면에 남겨야 하는 지점 — **눈**.
 *
 * 원형 아이콘처럼 정사각으로 쓸 때는 문제가 없지만, 가로로 긴 자리에 `cover` 로
 * 깔면 위아래가 잘린다. 그때 하나의 전역값(`center 22%` 같은)을 쓰면 어떤 그림은
 * 이마만, 어떤 그림은 입만 남는다. 그림마다 눈높이가 다르기 때문이다 — 머리
 * 장식이 큰 그림은 얼굴이 아래로 내려가고, 얼굴을 클로즈업한 그림은 위로 올라간다.
 *
 * 사람은 얼굴에서 눈을 먼저 본다. 눈이 잘린 초상은 누구인지 알아보기 어렵다.
 *
 * 값은 CSS `background-position` 문법 그대로다. 두 번째 값이 세로 초점이며,
 * 작을수록 위쪽을 남긴다.
 */
export interface PortraitCrop {
  /** CSS `background-position`. 두 번째 값이 세로 초점이며, **클수록 아래쪽**을 남긴다. */
  readonly focus: string;
  /**
   * `cover` 위에 더 얹는 확대 배율.
   *
   * 인물이 화면에서 차지하는 크기가 그림마다 다르다. 얼굴을 크게 잡은 그림은
   * `cover` 만으로 눈이 충분히 크게 나오지만, 상반신까지 들어간 그림은 같은
   * 조건에서 얼굴이 작아 누구인지 알아보기 어렵다. 그런 그림만 초점을 중심으로
   * 더 당긴다.
   */
  readonly zoom: number;
}

const PORTRAIT_CROP_BY_NAME: Readonly<Record<string, PortraitCrop>> = {
  // 눈썹만 걸려서 초점을 아래로 내렸다(값이 커질수록 그림의 아래쪽이 보인다).
  아모레또: { focus: "50% 56%", zoom: 1 },
  유레카: { focus: "48% 38%", zoom: 1 },
  "세나 아르벨": { focus: "46% 42%", zoom: 1 },
  // 상반신까지 들어간 그림이라 얼굴이 작다. 눈을 중심으로 더 당긴다.
  "토로리 코코": { focus: "50% 44%", zoom: 1.5 },
  망징이: { focus: "50% 42%", zoom: 1.55 },
};

/** 초점을 모르는 그림은 가운데를 확대 없이 쓴다 — 잘못 잘라 놓는 것보다 낫다. */
export const DEFAULT_PORTRAIT_CROP: PortraitCrop = { focus: "50% 50%", zoom: 1 };

export function streamerPortraitCrop(name: string | undefined): PortraitCrop {
  if (name === undefined) return DEFAULT_PORTRAIT_CROP;
  return PORTRAIT_CROP_BY_NAME[name] ?? DEFAULT_PORTRAIT_CROP;
}

export function streamerPortraitFocus(name: string | undefined): string {
  return streamerPortraitCrop(name).focus;
}
