import { getContext, setContext } from "svelte";

/**
 * The client state one report's controls share (#582).
 *
 * The SAME pending report is rendered twice — once in the pending list, once in
 * the reports history — so one report id owns two Approve buttons. Every state
 * change has to reach both, or the two places you look disagree. Each field here
 * is one DOM property the old page script set on every twin at once
 * (render.ts's `controlsFor`), so the twins read one value. The in-flight
 * spinner is the exception: it belongs to the clicked button alone.
 */
export class ReportUi {
  approveLabel = $state("Approve");
  approveDisabled: boolean = $state(false);
  approveTitle: string | null = $state(null);
  approved = $state(false);
  withdrawLabel = $state("Don't send");
  withdrawDisabled = $state(false);
  overrideToggleDisabled = $state(false);
  overrideSubmitDisabled = $state(false);
  overrideReasonDisabled = $state(false);

  constructor(approveDisabled: boolean) {
    this.approveDisabled = approveDisabled;
  }

  /** Once a report is approved, overridden or withdrawn, the override controls
   *  can only be refused by the server, so they go dead. */
  disableOverride(): void {
    this.overrideToggleDisabled = true;
    this.overrideSubmitDisabled = true;
    this.overrideReasonDisabled = true;
  }
}

const KEY = Symbol("report-ui");

export class ReportUiRegistry {
  #byId = new Map<string, ReportUi>();

  /** The shared state for a report, created on first use with the server's
   *  initial Approve gate (both twins are rendered from the same gate). */
  get(reportId: string, approveDisabled = false): ReportUi {
    let ui = this.#byId.get(reportId);
    if (!ui) {
      ui = new ReportUi(approveDisabled);
      this.#byId.set(reportId, ui);
    }
    return ui;
  }
}

export function provideReportUis(): ReportUiRegistry {
  return setContext(KEY, new ReportUiRegistry());
}

export function reportUis(): ReportUiRegistry {
  return getContext<ReportUiRegistry>(KEY);
}
