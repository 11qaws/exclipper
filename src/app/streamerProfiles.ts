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
  "아모레또": "amoretto.jpg",
  "유레카": "eureka.png",
  "세나 아르벨": "sena.jpg",
  "토로리 코코": "torori.png",
  "망징이": "mangjing.jpg",
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
 * 그림의 **파일명**. 배포 base 가 붙지 않은 날것이다.
 *
 * 하네스 생성기가 쓴다. 생성기가 자기 파일명 표를 따로 들면, 그림을 다른 형식으로
 * 바꾸는 순간(`sena.png` → `sena.jpg`) 소스만 바뀌고 하네스는 옛 파일을 계속
 * 가리킨다. 옛 파일이 아직 디스크에 있으면 404 조차 나지 않아서, 화면은 멀쩡한데
 * 바뀐 그림만 안 보인다.
 */
export function streamerProfileFileName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  return PROFILE_FILE_BY_NAME[name];
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

/**
 * 값은 `dev/focus-picker.html` 에서 그림을 보고 지정한 것이다. 손으로 고치지
 * 말고 도구를 다시 열어 맞춘다 — 눈으로 확인하지 않은 좌표는 반드시 빗나간다.
 */
const PORTRAIT_CROP_BY_NAME: Readonly<Record<string, PortraitCrop>> = {
  "아모레또": { focus: "53% 41%", zoom: 2.15 },
  "유레카": { focus: "60% 82%", zoom: 1.15 },
  "세나 아르벨": { focus: "22% 70%", zoom: 1.15 },
  "토로리 코코": { focus: "40% 61%", zoom: 1.8 },
  "망징이": { focus: "54% 38%", zoom: 3.5 },
};

/**
 * 이름 아래 한 줄. 그 항목이 **무엇인지** 말한다.
 *
 * 목록에서 이름만 보면 그것이 사람인지 색 이름인지 알 수 없다. 한 줄이 붙으면
 * 읽지 않고도 종류가 구분된다.
 *
 * 값은 `dev/focus-picker.html` 에서 고친다.
 */
const SUBTITLE_BY_NAME: Readonly<Record<string, string>> = {
  "아모레또": "교환학생 1기 ORIENT",
  "유레카": "교환학생 1기 ORIENT",
  "세나 아르벨": "교환학생 1기 ORIENT",
  "토로리 코코": "교환학생 1기 ORIENT",
  "망징이": "교환학생 1기 ORIENT",
};

export const DEFAULT_SUBTITLE = "";

export function streamerSubtitle(name: string | undefined): string {
  if (name === undefined) return DEFAULT_SUBTITLE;
  return SUBTITLE_BY_NAME[name] ?? DEFAULT_SUBTITLE;
}

/** 초점을 모르는 그림은 가운데를 확대 없이 쓴다 — 잘못 잘라 놓는 것보다 낫다. */
export const DEFAULT_PORTRAIT_CROP: PortraitCrop = { focus: "50% 50%", zoom: 1 };

export function streamerPortraitCrop(name: string | undefined): PortraitCrop {
  if (name === undefined) return DEFAULT_PORTRAIT_CROP;
  return PORTRAIT_CROP_BY_NAME[name] ?? DEFAULT_PORTRAIT_CROP;
}

export function streamerPortraitFocus(name: string | undefined): string {
  return streamerPortraitCrop(name).focus;
}
