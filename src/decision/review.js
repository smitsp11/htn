/** Presentation rules keep property appetite separate from other lines and account history. */
export const isPropertyCase = row => row.lineOfBusiness === 'property';
export const isHistoricalCase = row => ['bound', 'declined', 'lost', 'withdrawn'].includes(String(row.queueStatus ?? '').toLowerCase());

export function attentionFor(row) {
  if (!isPropertyCase(row)) return { title: 'Other line of business', detail: 'View account context. Commercial property rules do not apply to this submission.' };
  if (isHistoricalCase(row)) return { title: `Historical submission: ${row.queueStatus}`, detail: 'This submission already has a final status in Federato. Use its evidence and appetite assessment as reference; reviewing it here does not reopen or change that outcome.' };
  const failures = row.factors.filter(f => f.status === 'fail');
  const unknown = row.factors.filter(f => f.status === 'unknown');
  if (failures.length) return {
    title: `Review ${failures.length} appetite exception${failures.length === 1 ? '' : 's'}`,
    detail: `${failures.map(f => f.label).join(', ')} fall outside the guideline.${unknown.length ? ` ${unknown.length} factor(s) also need evidence.` : ''} Confirm whether to pursue an exception before requesting more documents.`,
  };
  if (unknown.length) return { title: `Resolve ${unknown.length} evidence gap${unknown.length === 1 ? '' : 's'}`, detail: `Needed: ${unknown.map(f => f.label.toLowerCase()).join(', ')}. Related records and AI context can guide the request; they do not establish the missing facts.` };
  if (row.issues?.length) return { title: 'Reconcile source records before progressing', detail: 'The appetite factors are established, but source linkage or data-quality issues remain. Review the recorded issues in the assessment summary.' };
  return { title: 'Review terms and record your decision', detail: 'The supplied property evidence meets the appetite checks. Review local findings and confirm the terms.' };
}

export function reviewTasks(row) {
  if (!isPropertyCase(row) || isHistoricalCase(row)) return [];
  return (row.tasks ?? []).map(task => {
    const factor = row.factors.find(f => f.key === task.factorKey);
    if (factor?.status !== 'fail') return { ...task, requestable: true };
    return {
      ...task, requestable: false,
      question: `${factor.reason} Review the exception, or obtain corrected evidence if this record is inaccurate.`,
      needs: [],
    };
  });
}
export const isRequestClosed = state => state === 'answered' || state === 'waived';

/** A draft only; copying it does not send anything or mark requests sent. */
export function evidenceRequest(row, states = {}) {
  const tasks = reviewTasks(row).filter(t => t.requestable && !isRequestClosed(states[t.id]));
  if (!tasks.length) return '';
  return `Subject: Information needed - ${row.submissionNumber} / ${row.accountName}\n\nPlease provide the following to complete our commercial property review:\n\n${tasks.map((t, i) => `${i + 1}. ${t.question}`).join('\n')}\n\nPlease include the source documents and dates covered. Thank you.`;
}
