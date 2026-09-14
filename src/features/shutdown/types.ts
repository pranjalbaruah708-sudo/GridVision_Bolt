export type ShutdownStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type ShutdownType = 'Planned' | 'Emergency';
export type ShutdownPurpose = 'Preventive Maintenance' | 'Corrective Maintenance' | 'Construction / Augmentation' | 'Tree Cutting' | 'Testing' | 'Line Work' | 'Transformer Work' | 'Protection Work' | 'Other';
export type ShutdownRecord = { id:string; sdNumber:string; stationId:string; stationName:string; feederId:string|null; feederName:string|null; equipmentName:string; shutdownType:ShutdownType; purpose:ShutdownPurpose; workDescription:string; plannedStart:string; expectedRestoration:string; remarks:string; requestedByUserId:string; requestedByName:string; requestedAt:string; status:ShutdownStatus; decisionByUserId?:string; decisionByName?:string; decisionAt?:string; decisionRemarks?:string; canDecide?:boolean; totalCount?:number };
export type CreateShutdownInput = Pick<ShutdownRecord,'stationId'|'feederId'|'equipmentName'|'shutdownType'|'purpose'|'workDescription'|'plannedStart'|'expectedRestoration'|'remarks'>;
export type ShutdownListFilters = { status?:ShutdownStatus; search?:string; stationId?:string; fromDate?:string; toDate?:string; limit:number; offset:number };
export type ShutdownReportFilters = { fromDate:string; toDate:string; stationId:string; status:ShutdownStatus|'ALL'; feederId:string; equipmentName:string; requestedByUserId:string; limit:number; offset:number };
export type ShutdownKpis = { total:number; pendingApproval:number; approved:number; rejected:number; cancelled:number };
