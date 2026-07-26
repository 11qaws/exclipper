/**
 * Finds the concurrency the relay actually tolerates, instead of guessing it.
 *
 * Every fixed number here has been wrong. Four was chosen against a transport
 * that no longer exists. Twelve was chosen against arithmetic that put the
 * payload at 7 MB when it is 2.75 MB, and it killed the relay anyway — so the
 * reasoning was wrong in both directions and the real ceiling is still unknown.
 *
 * It is also not one number. It depends on the machine, the network, and what
 * the upstream is doing at that moment, none of which can be read from here.
 *
 * So this climbs while requests succeed and retreats when they fail, and the
 * retreat is deliberately asymmetric: one step up after a run of successes, a
 * halving on the first failure. Overshooting does not merely slow things down —
 * a dead relay discards the work in flight, so the run has to redo it. Being
 * one below the ceiling costs a little time; being one above costs the batch.
 */

export interface AdaptiveConcurrencyOptions {
  readonly minimum: number;
  readonly maximum: number;
  readonly start: number;
  /** 이만큼 연속 성공하면 한 칸 올린다. */
  readonly raiseAfterSuccesses: number;
}

export const DEFAULT_ADAPTIVE_CONCURRENCY: AdaptiveConcurrencyOptions = {
  // 1 로 떨어지면 사실상 순차 처리다. 그래도 끝나는 것이 안 끝나는 것보다 낫다.
  minimum: 1,
  /**
   * 위쪽 상한.
   *
   * 무한히 올리지 않는 이유는 상류가 조용히 느려지는 구간이 있기 때문이다 —
   * 요청이 실패하지 않고 **느려지기만** 하면 이 알고리즘은 계속 올린다. 그
   * 지점을 아직 모르므로 관측된 값(12) 아래에 둔다.
   */
  maximum: 10,
  /** 마지막으로 안전하다고 확인된 값. */
  start: 4,
  /**
   * 네 번 연속 성공해야 한 칸 올린다.
   *
   * 한 번의 성공으로 올리면 실패 직전에서 오르내리기를 반복하며, 그 진동 자체가
   * 실패를 만든다.
   */
  raiseAfterSuccesses: 4,
};

export class AdaptiveConcurrency {
  private current: number;
  private consecutiveSuccesses = 0;
  /** 실패를 본 적이 있으면 그 아래에서만 논다. */
  private observedCeiling: number | null = null;

  public constructor(
    private readonly options: AdaptiveConcurrencyOptions = DEFAULT_ADAPTIVE_CONCURRENCY,
  ) {
    this.current = clamp(options.start, options.minimum, options.maximum);
  }

  public get limit(): number {
    return this.current;
  }

  public onSuccess(): void {
    this.consecutiveSuccesses += 1;
    if (this.consecutiveSuccesses < this.options.raiseAfterSuccesses) return;
    this.consecutiveSuccesses = 0;

    // 실패를 본 적이 있으면 그 값에 다시 닿지 않는다. 같은 벽에 반복해서
    // 부딪히면 그때마다 작업을 버린다.
    const ceiling =
      this.observedCeiling === null
        ? this.options.maximum
        : Math.min(this.options.maximum, this.observedCeiling - 1);
    this.current = clamp(this.current + 1, this.options.minimum, ceiling);
  }

  /**
   * 요청이 실패했을 때.
   *
   * 실패의 **종류를 보지 않는다.** 릴레이가 죽으면 브라우저에는 CORS 위반으로
   * 보이고, 상류가 조이면 429 로 보이며, 시간이 넘으면 abort 로 보인다. 원인은
   * 다르지만 대응은 같다 — 덜 보낸다. 종류를 구분하려 들면 그 구분이 또 틀린다.
   */
  public onFailure(): void {
    this.consecutiveSuccesses = 0;
    this.observedCeiling =
      this.observedCeiling === null
        ? this.current
        : Math.min(this.observedCeiling, this.current);
    this.current = clamp(
      Math.floor(this.current / 2),
      this.options.minimum,
      this.options.maximum,
    );
  }

  /** 진단용. 어디까지 올라갔고 무엇에 막혔는지. */
  public describe(): string {
    return this.observedCeiling === null
      ? `동시 ${this.current} (상한 미확인)`
      : `동시 ${this.current} (${this.observedCeiling} 에서 실패)`;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/**
 * 프록시의 분당 요청 상한. `wrangler.jsonc` 의 `limit` 과 같아야 한다.
 *
 * **이 값은 올릴 수 없다** — 무료 플랜의 고정 한도다. 그래서 클라이언트가 스스로
 * 맞춰야 하고, 넘기면 429 가 돌아온다. 429 는 적응형 동시성이 실패로 읽어 물러
 * 나므로 결국 멈추지는 않지만, 그 한 번마다 **청크 하나가 gap 으로 버려진다.**
 * 맞고 물러나는 것보다 처음부터 그 속도로 보내는 편이 낫다.
 */
const PROXY_REQUESTS_PER_MINUTE = 60;

/**
 * 다음 요청까지 기다릴 시간.
 *
 * 청크를 30초로 줄이면서 방송 하나가 273 요청이 됐다. 분당 60 이 상한이므로
 * 바닥은 4.5분이고, 실측 전사가 4.1분이었으니 **이 한도가 이제 실질적인 속도를
 * 정한다.** 더 잘게 쪼개도 빨라지지 않는다는 뜻이기도 하다.
 */
export function requestSpacingMs(): number {
  return Math.ceil(60_000 / PROXY_REQUESTS_PER_MINUTE);
}
