const React = require('react');
const { isTeacher } = require('./access');
const h = React.createElement;

const ACTIVITIES = Object.freeze([
  { id: 'learn', label: 'Μαθαίνω', detail: 'Μάθηση με δραστηριότητες LGU.' },
  { id: 'play', label: 'Παίζω', detail: 'Παιχνίδι και εξάσκηση στο LGU.' },
  { id: 'live', label: 'Live', detail: 'Ζωντανή δραστηριότητα με την τάξη.' },
]);

const STYLES = `
.lgu-activities { box-sizing: border-box; padding: 24px; color: #172b43; background: #f7f9fc; min-height: 100%; font: 16px/1.5 system-ui, sans-serif; }
.lgu-activities * { box-sizing: border-box; }
.lgu-activities h2 { margin: 4px 0 8px; font-size: 24px; }
.lgu-activities p { margin: 0 0 16px; }
.lgu-activities__badge { display: inline-block; padding: 4px 10px; margin-bottom: 12px; border-radius: 20px; background: #e5eafa; color: #304575; font-size: 12px; font-weight: 700; }
.lgu-activities__choices { display: grid; gap: 12px; }
.lgu-activities__choice { display: block; width: 100%; text-align: start; border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; background: #fff; color: #172b43; cursor: pointer; font: inherit; }
.lgu-activities__choice strong { display: block; font-size: 19px; }
.lgu-activities__choice span { display: block; margin-top: 4px; color: #52627a; font-size: 14px; }
.lgu-activities__choice:hover { border-color: #5165ba; background: #f0f3ff; }
.lgu-activities__choice[aria-pressed="true"] { border-color: #3c50a0; background: #edf1ff; }
.lgu-activities__choice:focus-visible { outline: 3px solid #3c50a0; outline-offset: 3px; }
.lgu-activities__notice { margin-top: 20px; padding: 16px; border-radius: 12px; background: #e8eef7; }
@media (max-width: 400px) { .lgu-activities { padding: 16px; } }
`;

function TeacherPanel({ pluginApi }) {
  const user = pluginApi.useCurrentUser();
  const [selected, setSelected] = React.useState(null);
  React.useEffect(() => { if (!isTeacher(user)) setSelected(null); }, [isTeacher(user)]);

  if (!isTeacher(user)) {
    return h('section', { className: 'lgu-activities', lang: 'el', 'aria-live': 'polite' },
      h('p', null, user?.loading !== false && !user?.error
        ? 'Έλεγχος ρόλου…' : 'Το panel είναι διαθέσιμο μόνο στον εκπαιδευτικό.'));
  }
  const activity = ACTIVITIES.find((item) => item.id === selected);
  return h('section', { className: 'lgu-activities', lang: 'el', 'aria-label': 'LGU Activities' },
    h('style', null, STYLES),
    h('span', { className: 'lgu-activities__badge' }, 'PHASE 1 · INTEGRATION SHELL'),
    h('h2', null, 'LGU Activities'),
    h('p', null, 'Επίλεξε πώς θέλεις να δουλέψεις με την τάξη σου.'),
    h('div', { className: 'lgu-activities__choices', 'aria-label': 'Δραστηριότητες' },
      ...ACTIVITIES.map((item) => h('button', {
        key: item.id, type: 'button', className: 'lgu-activities__choice',
        'aria-pressed': selected === item.id,
        'data-testid': `lgu-activity-${item.id}`,
        onClick: () => setSelected(item.id),
      }, h('strong', null, item.label), h('span', null, item.detail)))),
    h('div', { className: 'lgu-activities__notice', role: 'status', 'aria-live': 'polite' },
      activity ? `${activity.label}: θα συνδεθεί με το LGU σε επόμενη φάση. Δεν ξεκίνησε δραστηριότητα.`
        : 'Ασφαλές περίβλημα ενσωμάτωσης. Δεν υπάρχει ακόμη σύνδεση με το LGU backend.'));
}

module.exports = { ACTIVITIES, TeacherPanel };