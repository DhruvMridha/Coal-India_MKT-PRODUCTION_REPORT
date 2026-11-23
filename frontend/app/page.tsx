import {ReportWorkspace} from '@/components/report-workspace';
import {reportingDay} from '@/lib/report';
export const dynamic='force-dynamic';
export default function Page(){return <ReportWorkspace today={reportingDay()}/>}
