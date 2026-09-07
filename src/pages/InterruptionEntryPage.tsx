import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Clock3,
  ZapOff,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  UploadCloud,
  X,
} from 'lucide-react';

import { api } from '@/services/api';
import { supabase } from '@/services/supabase';
import { useApp } from '@/context/AppContext';
import {
  getQueuedInterruptionOperations,
  isOnline as hasNetworkConnection,
  OFFLINE_QUEUE_CHANGED_EVENT,
  type QueuedOp,
} from '@/services/offline';

import type {
  Feeder,
  Interruption,
} from '@/types';

/* =========================================================
   INTERRUPTION REASONS
========================================================= */

const INTERRUPTION_REASONS = [
  'Equipment Fault',
  'External Fault',
  'Scheduled Work',
  'Overload',
  'Others',
] as const;

/* =========================================================
   DATABASE INTERRUPTION VIEW
========================================================= */

type DbInterruption = Interruption & {
  id: string;
  station_id: string;
  feeder_id?: string | null;
  operator_id?: string | null;

  interruption_start?: string;
  interruption_end?: string | null;

  current_status?:
    | 'OPEN'
    | 'RESTORED'
    | 'CANCELLED';

  cause?: string | null;
  remarks?: string | null;

  duration_minutes?: number | null;
  etr?: string | null;
};

type VisibleInterruption = Interruption & {
  syncStatus?: 'SYNCED' | 'PENDING' | 'FAILED';
  queuedOperation?: QueuedOp;
};

/* =========================================================
   DATE / TIME HELPERS
========================================================= */

function currentLocalDateTime(): string {
  const now = new Date();

  const offset =
    now.getTimezoneOffset();

  const local = new Date(
    now.getTime() -
      offset * 60_000
  );

  return local
    .toISOString()
    .slice(0, 16);
}

function localInputToISO(
  value: string
): string {
  return new Date(
    value
  ).toISOString();
}

function formatDateTime(
  value?: string | null
): string {
  if (!value) {
    return '—';
  }

  return new Date(
    value
  ).toLocaleString(
    'en-IN',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  );
}

/* =========================================================
   INTERRUPTION FIELD HELPERS
========================================================= */

function getInterruptionStart(
  interruption: Interruption
): string | null {
  const row =
    interruption as DbInterruption;

  return (
    row.interruption_start ??
    null
  );
}

function getInterruptionFeederId(
  interruption: Interruption
): string | null {
  const row =
    interruption as DbInterruption;

  return (
    row.feeder_id ??
    null
  );
}

function getInterruptionCause(
  interruption: Interruption
): string {
  const row =
    interruption as DbInterruption;

  return (
    row.cause ??
    '—'
  );
}

function getInterruptionRemarks(
  interruption: Interruption
): string | null {
  const row =
    interruption as DbInterruption;

  return (
    row.remarks ??
    null
  );
}

/* =========================================================
   PAGE
========================================================= */

export function InterruptionEntryPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const {
    stations,
    feeders: authorizedFeeders,
    online,
    pending,
    error: stationScopeError,
  } = useApp();

  /* =======================================================
     LOGGED-IN OPERATOR
  ======================================================= */

  const [
    operatorUserId,
    setOperatorUserId,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     OPERATOR STATION
  ======================================================= */

  const [
    operatorStationId,
    setOperatorStationId,
  ] = useState<
    string | null
  >(null);

  const [
    operatorStationName,
    setOperatorStationName,
  ] = useState(
    'Loading station...'
  );

  const [
    stationFeeders,
    setStationFeeders,
  ] = useState<
    Feeder[]
  >([]);

  const [
    stationLoading,
    setStationLoading,
  ] = useState(
    true
  );

  /* =======================================================
     INTERRUPTION FORM
  ======================================================= */

  const [
    feederId,
    setFeederId,
  ] = useState('');

  const [
    reason,
    setReason,
  ] = useState('');

  const [
    otherReason,
    setOtherReason,
  ] = useState('');

  const [
    tripTime,
    setTripTime,
  ] = useState(
    currentLocalDateTime()
  );

  /* =======================================================
     OPEN INTERRUPTIONS
  ======================================================= */

  const [
    serverOpenInterruptions,
    setServerOpenInterruptions,
  ] = useState<
    Interruption[]
  >([]);

  const [queueRevision, setQueueRevision] = useState(0);

  const [
    loading,
    setLoading,
  ] = useState(
    true
  );

  const [
    creating,
    setCreating,
  ] = useState(
    false
  );

  const [
    restoring,
    setRestoring,
  ] = useState(
    false
  );

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  /* =======================================================
     TRIP CONFIRMATION
  ======================================================= */

  const [
    showTripConfirmation,
    setShowTripConfirmation,
  ] = useState(
    false
  );

  const [
    lastPromptKey,
    setLastPromptKey,
  ] = useState('');

  /* =======================================================
     RESTORE MODAL
  ======================================================= */

  const [
    selectedInterruption,
    setSelectedInterruption,
  ] = useState<
    Interruption | null
  >(null);

  const [
    restoreTime,
    setRestoreTime,
  ] = useState(
    currentLocalDateTime()
  );

  /* =======================================================
     LOAD OPERATOR + ASSIGNED STATION
  ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    async function loadOperatorStation() {
      setStationLoading(
        true
      );

      setError(
        null
      );

      try {
        if (!hasNetworkConnection()) {
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          const user = sessionData.session?.user;
          if (!user) throw new Error('No authenticated operator found.');
          const cachedStation = stations[0];
          if (!cachedStation) throw new Error('Offline operational scope is unavailable. Connect once to refresh your authorized station and feeders.');
          if (cancelled) return;

          setOperatorUserId(user.id);
          setOperatorStationId(cachedStation.id);
          setOperatorStationName(cachedStation.name);
          setStationFeeders(authorizedFeeders.filter((feeder) => feeder.station_id === cachedStation.id));
          setFeederId('');
          return;
        }

        const {
          data: {
            user,
          },
          error:
            userError,
        } =
          await supabase.auth.getUser();

        if (
          userError
        ) {
          throw userError;
        }

        if (!user) {
          throw new Error(
            'No authenticated operator found.'
          );
        }

        if (
          cancelled
        ) {
          return;
        }

        setOperatorUserId(
          user.id
        );

        const {
          data:
            assignment,
          error:
            assignmentError,
        } =
          await supabase
            .from(
              'user_stations'
            )
            .select(
              'station_id'
            )
            .eq(
              'user_id',
              user.id
            )
            .eq(
              'active',
              true
            )
            .limit(
              1
            )
            .maybeSingle();

        if (
          assignmentError
        ) {
          throw assignmentError;
        }

        if (
          !assignment?.station_id
        ) {
          if (
            !cancelled
          ) {
            setOperatorStationId(
              null
            );

            setOperatorStationName(
              'No station assigned'
            );

            setStationFeeders(
              []
            );

            setFeederId(
              ''
            );
          }

          return;
        }

        const stationId =
          assignment.station_id;

        if (
          cancelled
        ) {
          return;
        }

        setOperatorStationId(
          stationId
        );

        const stationFromContext =
          stations.find(
            (
              station
            ) =>
              station.id ===
              stationId
          );

        if (
          stationFromContext
        ) {
          setOperatorStationName(
            stationFromContext.name
          );
        } else {
          const {
            data:
              stationRow,
            error:
              stationError,
          } =
            await supabase
              .from(
                'stations'
              )
              .select(
                'id, name'
              )
              .eq(
                'id',
                stationId
              )
              .single();

          if (
            stationError
          ) {
            throw stationError;
          }

          if (
            !cancelled
          ) {
            setOperatorStationName(
              stationRow.name
            );
          }
        }

        const feeders =
          await api.getFeeders(
            stationId
          );

        if (
          cancelled
        ) {
          return;
        }

        setStationFeeders(
          feeders
        );

        setFeederId(
          ''
        );
      } catch (
        e
      ) {
        console.error(
          'Failed to load operator station:',
          e
        );

        if (
          !cancelled
        ) {
          setOperatorUserId(
            null
          );

          setOperatorStationId(
            null
          );

          setOperatorStationName(
            'Station unavailable'
          );

          setStationFeeders(
            []
          );

          setFeederId(
            ''
          );

          setError(
            e instanceof Error
              ? e.message
              : 'Failed to load operator station.'
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setStationLoading(
            false
          );
        }
      }
    }

    void loadOperatorStation();

    return () => {
      cancelled =
        true;
    };
  }, [
    stations,
    authorizedFeeders,
    online,
  ]);

  useEffect(() => {
    const refreshQueue = () => setQueueRevision((revision) => revision + 1);
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refreshQueue);
    return () => window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refreshQueue);
  }, []);

  /* =======================================================
     FEEDER LOOKUP
  ======================================================= */

  const feederMap =
    useMemo(
      () =>
        new Map(
          stationFeeders.map(
            (
              feeder
            ) => [
              feeder.id,
              feeder.name,
            ]
          )
        ),
      [
        stationFeeders,
      ]
    );

  const selectedFeeder =
    useMemo(
      () =>
        stationFeeders.find(
          (
            feeder
          ) =>
            feeder.id ===
            feederId
        ) ??
        null,
      [
        stationFeeders,
        feederId,
      ]
    );

  const [queuedInterruptionOps, setQueuedInterruptionOps] = useState<QueuedOp[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!operatorUserId) {
      setQueuedInterruptionOps([]);
      return () => { cancelled = true; };
    }
    void getQueuedInterruptionOperations(operatorUserId).then((operations) => {
      if (!cancelled) setQueuedInterruptionOps(operations);
    }).catch((cause) => {
      if (!cancelled) {
        setQueuedInterruptionOps([]);
        setError(cause instanceof Error ? cause.message : 'Offline operational storage is unavailable.');
      }
    });
    return () => { cancelled = true; };
  }, [operatorUserId, queueRevision, pending]);

  const openInterruptions = useMemo<VisibleInterruption[]>(() => {
    if (!operatorStationId) return [];
    const restores = queuedInterruptionOps.filter((op) => op.operationType === 'RESTORE_INTERRUPTION');
    const locallyRestoredIds = new Set(restores.map((op) => op.localEntityId).filter((id): id is string => Boolean(id)));
    const serverRestoredIds = new Set(restores.map((op) => op.serverEntityId ?? op.filter?.id).filter((id): id is string => Boolean(id)));

    const serverRows = serverOpenInterruptions
      .filter((row) => !serverRestoredIds.has(row.id))
      .map((row) => ({ ...row, syncStatus: 'SYNCED' as const }));

    const localRows = queuedInterruptionOps
      .filter((op) => op.operationType === 'ADD_INTERRUPTION' && op.localEntityId && !locallyRestoredIds.has(op.localEntityId))
      .flatMap((op): VisibleInterruption[] => {
        if (!op.body || typeof op.body !== 'object' || Array.isArray(op.body)) return [];
        const body = op.body as Record<string, unknown>;
        if (body.station_id !== operatorStationId || typeof body.feeder_id !== 'string' || typeof body.interruption_start !== 'string') return [];
        return [{
          id: op.localEntityId as string,
          station_id: operatorStationId,
          feeder_id: body.feeder_id,
          operator_id: typeof body.operator_id === 'string' ? body.operator_id : null,
          interruption_start: body.interruption_start,
          interruption_end: null,
          duration_minutes: null,
          cause: typeof body.cause === 'string' ? body.cause : null,
          remarks: typeof body.remarks === 'string' ? body.remarks : null,
          current_status: 'OPEN',
          etr: typeof body.etr === 'string' ? body.etr : null,
          syncStatus: op.retryCount > 0 ? 'FAILED' : 'PENDING',
          queuedOperation: op,
        }];
      });

    const serverClientIds = new Set(serverRows.map((row) => row.client_operation_id).filter(Boolean));
    return [...localRows.filter((row) => !serverClientIds.has(row.queuedOperation?.clientOperationId)), ...serverRows]
      .sort((a, b) => +new Date(b.interruption_start) - +new Date(a.interruption_start));
  }, [operatorStationId, queuedInterruptionOps, serverOpenInterruptions]);

  const failedInterruptionChanges = queuedInterruptionOps.filter((op) => op.retryCount > 0).length;

  /* =======================================================
     OPEN FEEDER IDS

     Feeder cannot be tripped again until restored.
  ======================================================= */

  const openFeederIds =
    useMemo(
      () =>
        new Set(
          openInterruptions
            .map(
              (
                interruption
              ) =>
                getInterruptionFeederId(
                  interruption
                )
            )
            .filter(
              (
                id
              ): id is string =>
                Boolean(
                  id
                )
            )
        ),
      [
        openInterruptions,
      ]
    );

  function feederNameFor(
    interruption:
      Interruption
  ): string {
    const id =
      getInterruptionFeederId(
        interruption
      );

    if (!id) {
      return 'Unknown Feeder';
    }

    return (
      feederMap.get(
        id
      ) ??
      'Unknown Feeder'
    );
  }

  /* =======================================================
     LOAD OPEN INTERRUPTIONS
  ======================================================= */

  const loadOpenInterruptions =
    useCallback(
      async () => {
        if (
          !operatorStationId
        ) {
          setServerOpenInterruptions(
            []
          );

          setLoading(
            false
          );

          return;
        }

        setLoading(
          true
        );

        setError(
          null
        );

        try {
          const rows =
            await api.getInterruptions(
              operatorStationId,
              'OPEN'
            );

          rows.sort(
            (
              a,
              b
            ) => {
              const startA =
                getInterruptionStart(
                  a
                );

              const startB =
                getInterruptionStart(
                  b
                );

              return (
                +new Date(
                  startB ??
                    0
                ) -
                +new Date(
                  startA ??
                    0
                )
              );
            }
          );

          setServerOpenInterruptions(
            rows
          );
        } catch (
          e
        ) {
          console.error(
            'Failed to load open interruptions:',
            e
          );

          setError(
            e instanceof Error
              ? e.message
              : 'Failed to load interruptions.'
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [
        operatorStationId,
      ]
    );

  useEffect(() => {
    void loadOpenInterruptions();
  }, [
    loadOpenInterruptions,
  ]);

  useEffect(() => {
    if (online && queueRevision > 0) void loadOpenInterruptions();
  }, [online, queueRevision, loadOpenInterruptions]);

  /* =======================================================
     AUTOMATIC CONFIRMATION POPUP

     For "Others", popup waits until remarks are filled.
  ======================================================= */

  useEffect(() => {
    if (
      !feederId ||
      !reason ||
      !tripTime
    ) {
      return;
    }

    if (
      reason === 'Others' &&
      !otherReason.trim()
    ) {
      return;
    }

    const promptKey =
      `${feederId}|` +
      `${reason}|` +
      `${otherReason.trim()}|` +
      `${tripTime}`;

    if (
      promptKey ===
      lastPromptKey
    ) {
      return;
    }

    setLastPromptKey(
      promptKey
    );

    setShowTripConfirmation(
      true
    );
  }, [
    feederId,
    reason,
    otherReason,
    tripTime,
    lastPromptKey,
  ]);

  /* =======================================================
     CREATE INTERRUPTION
  ======================================================= */

  async function confirmTrip() {
    if (
      !operatorStationId ||
      !operatorUserId ||
      !feederId ||
      !reason ||
      !tripTime
    ) {
      setShowTripConfirmation(
        false
      );

      setError(
        'Station, operator, feeder, trip time and reason are required.'
      );

      return;
    }

    /* -------------------------------------------------------
       Feeder already OPEN
    ------------------------------------------------------- */

    if (
      openFeederIds.has(
        feederId
      )
    ) {
      setShowTripConfirmation(
        false
      );

      setError(
        'This feeder is already tripped. Restore it before recording another interruption.'
      );

      return;
    }

    /* -------------------------------------------------------
       "Others" reason validation
    ------------------------------------------------------- */

    if (
      reason ===
        'Others' &&
      !otherReason.trim()
    ) {
      setShowTripConfirmation(
        false
      );

      setError(
        'Please specify the reason for interruption.'
      );

      return;
    }

    setCreating(
      true
    );

    setError(
      null
    );

    try {
      const created =
        await api.addInterruption(
          {
            station_id:
              operatorStationId,

            feeder_id:
              feederId,

            operator_id:
              operatorUserId,

            interruption_start:
              localInputToISO(
                tripTime
              ),

            interruption_end:
              null,

            cause:
              reason,

            remarks:
              reason ===
              'Others'
                ? otherReason.trim()
                : null,

            current_status:
              'OPEN',
          }
        );

      if (!created.id.startsWith('local:int:')) {
        setServerOpenInterruptions((current) => [created, ...current]);
      }

      setShowTripConfirmation(
        false
      );

      setFeederId(
        ''
      );

      setReason(
        ''
      );

      setOtherReason(
        ''
      );

      setTripTime(
        currentLocalDateTime()
      );

      setLastPromptKey(
        ''
      );
    } catch (
      e
    ) {
      console.error(
        'Failed to create interruption:',
        e
      );

      setError(
        e instanceof Error
          ? e.message
          : 'Failed to create interruption.'
      );
    } finally {
      setCreating(
        false
      );
    }
  }

  /* =======================================================
     OPEN RESTORE MODAL
  ======================================================= */

  function openRestoreModal(
    interruption:
      Interruption
  ) {
    setSelectedInterruption(
      interruption
    );

    setRestoreTime(
      currentLocalDateTime()
    );
  }

  /* =======================================================
     RESTORE FEEDER
  ======================================================= */

  async function restoreFeeder() {
    if (
      !selectedInterruption ||
      !restoreTime
    ) {
      return;
    }

    const interruptionStart =
      getInterruptionStart(
        selectedInterruption
      );

    if (
      interruptionStart &&
      new Date(
        restoreTime
      ).getTime() <
        new Date(
          interruptionStart
        ).getTime()
    ) {
      setError(
        'Restore time cannot be earlier than interruption start time.'
      );

      return;
    }

    setRestoring(
      true
    );

    setError(
      null
    );

    try {
      await api.restoreInterruption(
        selectedInterruption.id,
        localInputToISO(
          restoreTime
        ),
        selectedInterruption.id.startsWith('local:int:') ? selectedInterruption.id : undefined
      );

      setServerOpenInterruptions(
        (
          current
        ) =>
          current.filter(
            (
              item
            ) =>
              item.id !==
              selectedInterruption.id
          )
      );

      setSelectedInterruption(
        null
      );
    } catch (
      e
    ) {
      console.error(
        'Failed to restore interruption:',
        e
      );

      setError(
        e instanceof Error
          ? e.message
          : 'Failed to restore feeder.'
      );
    } finally {
      setRestoring(
        false
      );
    }
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div
      style={{
        minHeight:
          '100vh',

        background:
          '#EEF3F8',

        display:
          'flex',

        flexDirection:
          'column',
      }}
    >
      {/* ===================================================
          HEADER
      ==================================================== */}

      <div
        className="lg:!rounded-none lg:!border-b lg:!border-slate-200 lg:!bg-white lg:!text-slate-900 lg:!shadow-none"
        style={{
          background:
            'linear-gradient(135deg,#0D47A1,#1565C0)',

          color:
            'white',

          padding:
            16,

          paddingTop:
            22,

          paddingBottom:
            22,

          borderBottomLeftRadius:
            22,

          borderBottomRightRadius:
            22,

          boxShadow:
            '0 4px 12px rgba(0,0,0,.18)',
        }}
      >
        <div
          style={{
            display:
              'flex',

            alignItems:
              'center',

            justifyContent:
              'space-between',
          }}
        >
          <button
            onClick={
              onBack
            }

            className="rounded-full p-1 transition hover:bg-white/10 active:scale-95 lg:hidden"

            aria-label="Back"
          >
            <ArrowLeft
              size={
                24
              }
            />
          </button>

          <h2
            style={{
              margin:
                0,

              fontSize:
                22,

              fontWeight:
                700,
            }}
          >
            Interruption Entry
          </h2>

          <CalendarDays
            size={
              24
            }
          />
        </div>

        <div
          className="lg:!border-slate-200 lg:!bg-slate-50"
          style={{
            marginTop:
              18,

            background:
              'rgba(255,255,255,.16)',

            border:
              '1px solid rgba(255,255,255,.20)',

            borderRadius:
              14,

            padding:
              '11px 14px',
          }}
        >
          <div
            className="lg:!text-slate-500"
            style={{
              fontSize:
                10,

              textTransform:
                'uppercase',

              letterSpacing:
                '.08em',

              color:
                '#BFDBFE',

              fontWeight:
                700,
            }}
          >
            Operator Station
          </div>

          <div
            style={{
              marginTop:
                3,

              fontSize:
                15,

              fontWeight:
                700,
            }}
          >
            {stationLoading
              ? 'Loading station...'
              : operatorStationName}
          </div>
        </div>
      </div>

      {/* ===================================================
          BODY
      ==================================================== */}

      <div
        className="lg:mx-auto lg:w-full lg:max-w-6xl lg:px-8"
        style={{
          flex:
            1,

          overflowY:
            'auto',

          padding:
            16,

          paddingBottom:
            100,
        }}
      >
        <div
          role="status"
          aria-live="polite"
          className={`mb-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold lg:ml-auto lg:max-w-xl ${
            online
              ? pending > 0
                ? 'border-blue-200 bg-blue-50 text-blue-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          {online ? (
            pending > 0 ? <UploadCloud className="h-4 w-4 shrink-0" /> : <Cloud className="h-4 w-4 shrink-0" />
          ) : (
            <CloudOff className="h-4 w-4 shrink-0" />
          )}
          <span>
            {online
              ? pending > 0
                ? `Online · ${pending} change${pending === 1 ? '' : 's'} pending sync`
                : 'Online · All changes synced'
              : pending > 0
              ? `Offline · ${pending} interruption change${pending === 1 ? '' : 's'} pending sync`
              : 'Offline · Interruption changes are saved on this device and will sync automatically.'}
          </span>
        </div>

        {stationScopeError && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900">
            {stationScopeError}
          </div>
        )}

        {failedInterruptionChanges > 0 && (
          <div role="alert" className="mb-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Sync Failed · {failedInterruptionChanges} interruption change{failedInterruptionChanges === 1 ? '' : 's'} retained for retry.
          </div>
        )}

        {/* =================================================
            ERROR
        ================================================== */}

        {error && (
          <div
            style={{
              display:
                'flex',

              gap:
                10,

              alignItems:
                'flex-start',

              marginBottom:
                14,

              borderRadius:
                14,

              padding:
                14,

              background:
                '#FEF2F2',

              border:
                '1px solid #FECACA',

              color:
                '#B91C1C',
            }}
          >
            <AlertTriangle
              size={
                20
              }

              style={{
                flexShrink:
                  0,

                marginTop:
                  1,
              }}
            />

            <div
              style={{
                flex:
                  1,

                fontSize:
                  13,

                lineHeight:
                  1.45,
              }}
            >
              {error}
            </div>

            <button
              type="button"

              onClick={() =>
                setError(
                  null
                )
              }

              style={{
                border:
                  'none',

                background:
                  'transparent',

                color:
                  '#B91C1C',

                cursor:
                  'pointer',

                padding:
                  0,
              }}
            >
              <X
                size={
                  18
                }
              />
            </button>
          </div>
        )}

        {/* =================================================
            RECORD INTERRUPTION CARD
        ================================================== */}

        <div
          style={{
            background:
              '#ffffff',

            borderRadius:
              18,

            padding:
              18,

            boxShadow:
              '0 4px 12px rgba(0,0,0,.08)',

            border:
              '1px solid #E2E8F0',
          }}
        >
          <div
            style={{
              display:
                'flex',

              alignItems:
                'center',

              gap:
                12,

              marginBottom:
                18,
            }}
          >
            <div
              style={{
                width:
                  44,

                height:
                  44,

                borderRadius:
                  13,

                background:
                  '#FEE2E2',

                display:
                  'flex',

                alignItems:
                  'center',

                justifyContent:
                  'center',
              }}
            >
              <ZapOff
                size={
                  22
                }
                color="#DC2626"
              />
            </div>

            <div>
              <h3
                style={{
                  margin:
                    0,

                  fontSize:
                    16,

                  fontWeight:
                    700,

                  color:
                    '#1E293B',
                }}
              >
                Record Interruption
              </h3>

              <p
                style={{
                  margin:
                    '3px 0 0',

                  fontSize:
                    11,

                  color:
                    '#64748B',
                }}
              >
                Enter feeder trip details
              </p>
            </div>
          </div>

          {/* =================================================
              FEEDER
          ================================================== */}

          <label
            style={{
              display:
                'block',

              marginBottom:
                15,
            }}
          >
            <span
              style={{
                display:
                  'block',

                marginBottom:
                  6,

                fontSize:
                  11,

                fontWeight:
                  700,

                color:
                  '#475569',

                textTransform:
                  'uppercase',
              }}
            >
              Feeder
            </span>

            <div
              style={{
                position:
                  'relative',
              }}
            >
              <select
                value={
                  feederId
                }

                onChange={(
                  e
                ) =>
                  setFeederId(
                    e.target.value
                  )
                }

                disabled={
                  stationLoading ||
                  !operatorStationId
                }

                style={{
                  width:
                    '100%',

                  appearance:
                    'none',

                  border:
                    '1px solid #CBD5E1',

                  borderRadius:
                    12,

                  padding:
                    '12px 42px 12px 13px',

                  background:
                    '#F8FAFC',

                  color:
                    '#1E293B',

                  fontSize:
                    14,

                  fontWeight:
                    600,

                  outline:
                    'none',

                  opacity:
                    stationLoading ||
                    !operatorStationId
                      ? 0.6
                      : 1,
                }}
              >
                <option value="">
                  {stationLoading
                    ? 'Loading feeders...'
                    : stationFeeders.length ===
                      0
                    ? 'No feeders available'
                    : 'Select feeder'}
                </option>

                {stationFeeders.map(
                  (
                    feeder
                  ) => {
                    const isOpen =
                      openFeederIds.has(
                        feeder.id
                      );

                    return (
                      <option
                        key={
                          feeder.id
                        }

                        value={
                          feeder.id
                        }

                        disabled={
                          isOpen
                        }
                      >
                        {
                          feeder.name
                        }

                        {isOpen
                          ? ' — Already Tripped'
                          : ''}
                      </option>
                    );
                  }
                )}
              </select>

              <ChevronDown
                size={
                  18
                }

                color="#64748B"

                style={{
                  pointerEvents:
                    'none',

                  position:
                    'absolute',

                  right:
                    13,

                  top:
                    '50%',

                  transform:
                    'translateY(-50%)',
                }}
              />
            </div>
          </label>

          {/* =================================================
              TRIP DATE & TIME
          ================================================== */}

          <label
            style={{
              display:
                'block',

              marginBottom:
                15,
            }}
          >
            <span
              style={{
                display:
                  'block',

                marginBottom:
                  6,

                fontSize:
                  11,

                fontWeight:
                  700,

                color:
                  '#475569',

                textTransform:
                  'uppercase',
              }}
            >
              Trip Date & Time
            </span>

            <div
              style={{
                position:
                  'relative',
              }}
            >
              <Clock3
                size={
                  18
                }

                color="#64748B"

                style={{
                  position:
                    'absolute',

                  left:
                    13,

                  top:
                    '50%',

                  transform:
                    'translateY(-50%)',

                  pointerEvents:
                    'none',

                  zIndex:
                    1,
                }}
              />

              <input
                type="datetime-local"

                value={
                  tripTime
                }

                onChange={(
                  e
                ) =>
                  setTripTime(
                    e.target.value
                  )
                }

                style={{
                  width:
                    '100%',

                  boxSizing:
                    'border-box',

                  border:
                    '1px solid #CBD5E1',

                  borderRadius:
                    12,

                  padding:
                    '12px 12px 12px 42px',

                  background:
                    '#F8FAFC',

                  color:
                    '#1E293B',

                  fontSize:
                    14,

                  fontWeight:
                    600,

                  outline:
                    'none',

                  minHeight:
                    46,
                }}
              />
            </div>
          </label>

          {/* =================================================
              REASON
          ================================================== */}

          <label
            style={{
              display:
                'block',
            }}
          >
            <span
              style={{
                display:
                  'block',

                marginBottom:
                  6,

                fontSize:
                  11,

                fontWeight:
                  700,

                color:
                  '#475569',

                textTransform:
                  'uppercase',
              }}
            >
              Reason of Interruption
            </span>

            <div
              style={{
                position:
                  'relative',
              }}
            >
              <select
                value={
                  reason
                }

                onChange={(
                  e
                ) => {
                  const value =
                    e.target.value;

                  setReason(
                    value
                  );

                  if (
                    value !==
                    'Others'
                  ) {
                    setOtherReason(
                      ''
                    );
                  }
                }}

                style={{
                  width:
                    '100%',

                  appearance:
                    'none',

                  border:
                    '1px solid #CBD5E1',

                  borderRadius:
                    12,

                  padding:
                    '12px 42px 12px 13px',

                  background:
                    '#F8FAFC',

                  color:
                    reason
                      ? '#1E293B'
                      : '#64748B',

                  fontSize:
                    14,

                  fontWeight:
                    600,

                  outline:
                    'none',
                }}
              >
                <option value="">
                  Select reason
                </option>

                {INTERRUPTION_REASONS.map(
                  (
                    item
                  ) => (
                    <option
                      key={
                        item
                      }
                      value={
                        item
                      }
                    >
                      {
                        item
                      }
                    </option>
                  )
                )}
              </select>

              <ChevronDown
                size={
                  18
                }

                color="#64748B"

                style={{
                  pointerEvents:
                    'none',

                  position:
                    'absolute',

                  right:
                    13,

                  top:
                    '50%',

                  transform:
                    'translateY(-50%)',
                }}
              />
            </div>
          </label>

          {/* =================================================
              OTHER REASON / REMARKS
          ================================================== */}

          {reason ===
            'Others' && (
            <label
              style={{
                display:
                  'block',

                marginTop:
                  12,
              }}
            >
              <span
                style={{
                  display:
                    'block',

                  marginBottom:
                    6,

                  fontSize:
                    11,

                  fontWeight:
                    700,

                  color:
                    '#475569',

                  textTransform:
                    'uppercase',
                }}
              >
                Specify Other Reason
              </span>

              <textarea
                value={
                  otherReason
                }

                onChange={(
                  e
                ) =>
                  setOtherReason(
                    e.target.value
                  )
                }

                placeholder="Enter interruption reason"

                rows={
                  3
                }

                required

                style={{
                  width:
                    '100%',

                  boxSizing:
                    'border-box',

                  border:
                    '1px solid #CBD5E1',

                  borderRadius:
                    12,

                  padding:
                    '12px 13px',

                  background:
                    '#F8FAFC',

                  color:
                    '#1E293B',

                  fontSize:
                    14,

                  fontWeight:
                    500,

                  lineHeight:
                    1.45,

                  outline:
                    'none',

                  resize:
                    'vertical',
                }}
              />
            </label>
          )}
        </div>

        {/* =================================================
            CURRENT OPEN FEEDERS
        ================================================== */}

        <div
          style={{
            marginTop:
              18,
          }}
        >
          <div
            style={{
              marginBottom:
                10,

              display:
                'flex',

              alignItems:
                'center',

              justifyContent:
                'space-between',
            }}
          >
            <div>
              <h3
                style={{
                  margin:
                    0,

                  fontSize:
                    16,

                  fontWeight:
                    700,

                  color:
                    '#1E293B',
                }}
              >
                Currently Open Feeders
              </h3>

              <p
                style={{
                  margin:
                    '3px 0 0',

                  fontSize:
                    11,

                  color:
                    '#64748B',
                }}
              >
                Tap a feeder to restore supply
              </p>
            </div>

            <div
              style={{
                minWidth:
                  30,

                height:
                  30,

                padding:
                  '0 9px',

                borderRadius:
                  15,

                background:
                  '#FEE2E2',

                color:
                  '#B91C1C',

                fontSize:
                  12,

                fontWeight:
                  800,

                display:
                  'flex',

                alignItems:
                  'center',

                justifyContent:
                  'center',
              }}
            >
              {
                openInterruptions.length
              }
            </div>
          </div>

          {loading && (
            <div
              style={{
                background:
                  '#ffffff',

                borderRadius:
                  18,

                padding:
                  28,

                textAlign:
                  'center',

                color:
                  '#64748B',

                boxShadow:
                  '0 4px 12px rgba(0,0,0,.08)',

                fontSize:
                  14,

                fontWeight:
                  600,
              }}
            >
              Loading open feeders…
            </div>
          )}

          {!loading &&
            openInterruptions.length ===
              0 && (
              <div
                style={{
                  background:
                    '#ffffff',

                  borderRadius:
                    18,

                  padding:
                    28,

                  textAlign:
                    'center',

                  boxShadow:
                    '0 4px 12px rgba(0,0,0,.08)',

                  border:
                    '1px solid #D1FAE5',
                }}
              >
                <div
                  style={{
                    width:
                      52,

                    height:
                      52,

                    margin:
                      '0 auto 12px',

                    borderRadius:
                      '50%',

                    background:
                      '#D1FAE5',

                    display:
                      'flex',

                    alignItems:
                      'center',

                    justifyContent:
                      'center',
                  }}
                >
                  <CheckCircle2
                    size={
                      27
                    }
                    color="#059669"
                  />
                </div>

                <h4
                  style={{
                    margin:
                      0,

                    color:
                      '#1E293B',

                    fontSize:
                      15,
                  }}
                >
                  All Feeders Normal
                </h4>

                <p
                  style={{
                    margin:
                      '5px 0 0',

                    color:
                      '#64748B',

                    fontSize:
                      12,
                  }}
                >
                  There are no open interruptions at this station.
                </p>
              </div>
            )}

          {!loading &&
            openInterruptions.length >
              0 && (
              <div
                style={{
                  display:
                    'flex',

                  flexDirection:
                    'column',

                  gap:
                    12,
                }}
              >
                {openInterruptions.map(
                  (
                    interruption
                  ) => (
                    <button
                      key={
                        interruption.id
                      }

                      type="button"

                      onClick={() =>
                        openRestoreModal(
                          interruption
                        )
                      }

                      style={{
                        width:
                          '100%',

                        textAlign:
                          'left',

                        border:
                          '1px solid #FECACA',

                        borderRadius:
                          18,

                        padding:
                          15,

                        background:
                          '#ffffff',

                        boxShadow:
                          '0 4px 12px rgba(0,0,0,.08)',

                        cursor:
                          'pointer',
                      }}
                    >
                      <div
                        style={{
                          display:
                            'flex',

                          alignItems:
                            'flex-start',

                          gap:
                            13,
                        }}
                      >
                        <div
                          style={{
                            width:
                              44,

                            height:
                              44,

                            flexShrink:
                              0,

                            borderRadius:
                              13,

                            background:
                              '#FEE2E2',

                            display:
                              'flex',

                            alignItems:
                              'center',

                            justifyContent:
                              'center',
                          }}
                        >
                          <ZapOff
                            size={
                              22
                            }
                            color="#DC2626"
                          />
                        </div>

                        <div
                          style={{
                            flex:
                              1,

                            minWidth:
                              0,
                          }}
                        >
                          <div
                            style={{
                              display:
                                'flex',

                              justifyContent:
                                'space-between',

                              gap:
                                10,
                            }}
                          >
                            <h4
                              style={{
                                margin:
                                  0,

                                color:
                                  '#1E293B',

                                fontSize:
                                  15,

                                fontWeight:
                                  700,
                              }}
                            >
                              {feederNameFor(
                                interruption
                              )}
                            </h4>

                            <span
                              style={{
                                flexShrink:
                                  0,

                                borderRadius:
                                  20,

                                padding:
                                  '4px 9px',

                                background:
                                  '#FEE2E2',

                                color:
                                  '#B91C1C',

                                fontSize:
                                  9,

                                fontWeight:
                                  800,
                              }}
                            >
                              OPEN
                            </span>
                          </div>

                          <p
                            style={{
                              margin:
                                '6px 0 0',

                              fontSize:
                                12,

                              color:
                                '#64748B',
                            }}
                          >
                            {
                              getInterruptionCause(
                                interruption
                              )
                            }
                          </p>

                          <span
                            className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${
                              interruption.syncStatus === 'FAILED'
                                ? 'bg-red-50 text-red-700'
                                : interruption.syncStatus === 'PENDING'
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-emerald-50 text-emerald-700'
                            }`}
                            title={interruption.syncStatus === 'FAILED' ? interruption.queuedOperation?.lastError ?? 'This change will be retried.' : undefined}
                          >
                            {interruption.syncStatus === 'FAILED' ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : interruption.syncStatus === 'PENDING' ? (
                              <UploadCloud className="h-3 w-3" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3" />
                            )}
                            {interruption.syncStatus === 'FAILED'
                              ? 'Sync Failed'
                              : interruption.syncStatus === 'PENDING'
                              ? 'Pending Sync'
                              : 'Synced'}
                          </span>

                          {getInterruptionRemarks(
                            interruption
                          ) && (
                            <p
                              style={{
                                margin:
                                  '4px 0 0',

                                fontSize:
                                  11,

                                lineHeight:
                                  1.4,

                                color:
                                  '#94A3B8',
                              }}
                            >
                              {
                                getInterruptionRemarks(
                                  interruption
                                )
                              }
                            </p>
                          )}

                          <div
                            style={{
                              marginTop:
                                10,

                              paddingTop:
                                9,

                              borderTop:
                                '1px solid #E2E8F0',

                              fontSize:
                                10,

                              color:
                                '#94A3B8',

                              display:
                                'flex',

                              justifyContent:
                                'space-between',

                              gap:
                                10,
                            }}
                          >
                            <span>
                              Trip Time
                            </span>

                            <span
                              style={{
                                fontWeight:
                                  600,

                                color:
                                  '#64748B',
                              }}
                            >
                              {formatDateTime(
                                getInterruptionStart(
                                  interruption
                                )
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                )}
              </div>
            )}
        </div>
      </div>

      {/* ===================================================
          CONFIRM TRIP MODAL
      ==================================================== */}

      {showTripConfirmation &&
        selectedFeeder && (
          <div
            style={{
              position:
                'fixed',

              inset:
                0,

              zIndex:
                1000,

              background:
                'rgba(15,23,42,.55)',

              backdropFilter:
                'blur(3px)',

              display:
                'flex',

              alignItems:
                'center',

              justifyContent:
                'center',

              padding:
                18,
            }}
          >
            <div
              style={{
                width:
                  '100%',

                maxWidth:
                  420,

                background:
                  '#ffffff',

                borderRadius:
                  22,

                overflow:
                  'hidden',

                boxShadow:
                  '0 24px 60px rgba(0,0,0,.25)',
              }}
            >
              <div
                style={{
                  padding:
                    18,

                  background:
                    'linear-gradient(135deg,#B91C1C,#DC2626)',

                  color:
                    '#ffffff',
                }}
              >
                <div
                  style={{
                    display:
                      'flex',

                    justifyContent:
                      'space-between',

                    alignItems:
                      'center',
                  }}
                >
                  <div
                    style={{
                      display:
                        'flex',

                      alignItems:
                        'center',

                      gap:
                        10,
                    }}
                  >
                    <AlertTriangle
                      size={
                        22
                      }
                    />

                    <h3
                      style={{
                        margin:
                          0,

                        fontSize:
                          18,

                        fontWeight:
                          700,
                      }}
                    >
                      Confirm Interruption
                    </h3>
                  </div>

                  <button
                    type="button"

                    onClick={() =>
                      setShowTripConfirmation(
                        false
                      )
                    }

                    style={{
                      border:
                        'none',

                      background:
                        'transparent',

                      color:
                        '#ffffff',

                      cursor:
                        'pointer',
                    }}
                  >
                    <X
                      size={
                        22
                      }
                    />
                  </button>
                </div>
              </div>

              <div
                style={{
                  padding:
                    20,
                }}
              >
                <p
                  style={{
                    margin:
                      '0 0 17px',

                    fontSize:
                      13,

                    color:
                      '#64748B',
                  }}
                >
                  Please confirm the following feeder interruption.
                </p>

                <ModalRow
                  label="Station"
                  value={
                    operatorStationName
                  }
                />

                <ModalRow
                  label="Feeder"
                  value={
                    selectedFeeder.name
                  }
                />

                <ModalRow
                  label="Trip Time"
                  value={formatDateTime(
                    localInputToISO(
                      tripTime
                    )
                  )}
                />

                <ModalRow
                  label="Reason"
                  value={
                    reason
                  }
                />

                {reason ===
                  'Others' && (
                  <ModalRow
                    label="Details"
                    value={
                      otherReason.trim()
                    }
                  />
                )}

                <div
                  style={{
                    display:
                      'flex',

                    gap:
                      10,

                    marginTop:
                      20,
                  }}
                >
                  <button
                    type="button"

                    disabled={
                      creating
                    }

                    onClick={() =>
                      setShowTripConfirmation(
                        false
                      )
                    }

                    style={{
                      flex:
                        1,

                      border:
                        '1px solid #CBD5E1',

                      borderRadius:
                        11,

                      padding:
                        '12px 10px',

                      background:
                        '#ffffff',

                      color:
                        '#475569',

                      fontWeight:
                        700,

                      cursor:
                        'pointer',
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"

                    disabled={
                      creating
                    }

                    onClick={() =>
                      void confirmTrip()
                    }

                    style={{
                      flex:
                        1.5,

                      border:
                        'none',

                      borderRadius:
                        11,

                      padding:
                        '12px 10px',

                      background:
                        creating
                          ? '#94A3B8'
                          : '#DC2626',

                      color:
                        '#ffffff',

                      fontWeight:
                        700,

                      cursor:
                        creating
                          ? 'default'
                          : 'pointer',
                    }}
                  >
                    {creating
                      ? 'Saving...'
                      : 'Confirm Trip'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* ===================================================
          RESTORE MODAL
      ==================================================== */}

      {selectedInterruption && (
        <div
          style={{
            position:
              'fixed',

            inset:
              0,

            zIndex:
              1000,

            background:
              'rgba(15,23,42,.55)',

            backdropFilter:
              'blur(3px)',

            display:
              'flex',

            alignItems:
              'center',

            justifyContent:
              'center',

            padding:
              18,
          }}
        >
          <div
            style={{
              width:
                '100%',

              maxWidth:
                420,

              background:
                '#ffffff',

              borderRadius:
                22,

              overflow:
                'hidden',

              boxShadow:
                '0 24px 60px rgba(0,0,0,.25)',
            }}
          >
            <div
              style={{
                padding:
                  18,

                background:
                  'linear-gradient(135deg,#047857,#059669)',

                color:
                  '#ffffff',
              }}
            >
              <div
                style={{
                  display:
                    'flex',

                  justifyContent:
                    'space-between',

                  alignItems:
                    'center',
                }}
              >
                <div
                  style={{
                    display:
                      'flex',

                    gap:
                      10,

                    alignItems:
                      'center',
                  }}
                >
                  <RotateCcw
                    size={
                      22
                    }
                  />

                  <h3
                    style={{
                      margin:
                        0,

                      fontSize:
                        18,

                      fontWeight:
                        700,
                    }}
                  >
                    Restore Feeder
                  </h3>
                </div>

                <button
                  type="button"

                  onClick={() =>
                    setSelectedInterruption(
                      null
                    )
                  }

                  style={{
                    border:
                      'none',

                    background:
                      'transparent',

                    color:
                      '#ffffff',

                    cursor:
                      'pointer',
                  }}
                >
                  <X
                    size={
                      22
                    }
                  />
                </button>
              </div>
            </div>

            <div
              style={{
                padding:
                  20,
              }}
            >
              <ModalRow
                label="Station"
                value={
                  operatorStationName
                }
              />

              <ModalRow
                label="Feeder"
                value={feederNameFor(
                  selectedInterruption
                )}
              />

              <ModalRow
                label="Interruption Start"
                value={formatDateTime(
                  getInterruptionStart(
                    selectedInterruption
                  )
                )}
              />

              <ModalRow
                label="Reason"
                value={
                  getInterruptionCause(
                    selectedInterruption
                  )
                }
              />

              {getInterruptionRemarks(
                selectedInterruption
              ) && (
                <ModalRow
                  label="Details"
                  value={
                    getInterruptionRemarks(
                      selectedInterruption
                    ) ??
                    ''
                  }
                />
              )}

              <div
                style={{
                  marginTop:
                    18,
                }}
              >
                <label
                  style={{
                    display:
                      'block',

                    marginBottom:
                      7,

                    color:
                      '#475569',

                    fontSize:
                      11,

                    fontWeight:
                      700,

                    textTransform:
                      'uppercase',
                  }}
                >
                  Restore Date & Time
                </label>

                <input
                  type="datetime-local"

                  value={
                    restoreTime
                  }

                  onChange={(
                    e
                  ) =>
                    setRestoreTime(
                      e.target.value
                    )
                  }

                  style={{
                    width:
                      '100%',

                    boxSizing:
                      'border-box',

                    border:
                      '1px solid #CBD5E1',

                    borderRadius:
                      11,

                    padding:
                      12,

                    background:
                      '#F8FAFC',

                    color:
                      '#1E293B',

                    fontSize:
                      14,

                    fontWeight:
                      600,
                  }}
                />
              </div>

              <div
                style={{
                  marginTop:
                    20,

                  display:
                    'flex',

                  gap:
                    10,
                }}
              >
                <button
                  type="button"

                  disabled={
                    restoring
                  }

                  onClick={() =>
                    setSelectedInterruption(
                      null
                    )
                  }

                  style={{
                    flex:
                      1,

                    border:
                      '1px solid #CBD5E1',

                    borderRadius:
                      11,

                    padding:
                      12,

                    background:
                      '#ffffff',

                    color:
                      '#475569',

                    fontWeight:
                      700,
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"

                  disabled={
                    restoring
                  }

                  onClick={() =>
                    void restoreFeeder()
                  }

                  style={{
                    flex:
                      1.5,

                    border:
                      'none',

                    borderRadius:
                      11,

                    padding:
                      12,

                    background:
                      restoring
                        ? '#94A3B8'
                        : '#059669',

                    color:
                      '#ffffff',

                    fontWeight:
                      700,
                  }}
                >
                  {restoring
                    ? 'Restoring...'
                    : 'Restore'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   MODAL DETAIL ROW
========================================================= */

function ModalRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        padding:
          '11px 0',

        borderBottom:
          '1px solid #E2E8F0',

        display:
          'flex',

        justifyContent:
          'space-between',

        alignItems:
          'flex-start',

        gap:
          15,
      }}
    >
      <span
        style={{
          color:
            '#64748B',

          fontSize:
            12,
        }}
      >
        {label}
      </span>

      <span
        style={{
          color:
            '#1E293B',

          fontSize:
            13,

          fontWeight:
            700,

          textAlign:
            'right',

          maxWidth:
            '65%',

          overflowWrap:
            'anywhere',
        }}
      >
        {value}
      </span>
    </div>
  );
}
