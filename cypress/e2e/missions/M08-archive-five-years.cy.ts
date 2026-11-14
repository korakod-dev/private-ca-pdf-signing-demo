// M8: somchai archives D01, a failing document cannot be archived, and after a 5-year advance the archived document is
// deleted while its SHA-256 stays in the audit log (admin-a). The mailbox holds the 30-day notice and the deletion mail.
// Pages used: /verify/:jobId (sub-task E), /archive + /admin/status (G), /mailbox (F), /missions (G).
import documents from '../../../src/fixtures/documents.json';
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import {
  GOLDEN,
  expectMissionDone,
  gotoPage,
  missionAtEachViewport,
  openResultOf,
  rowSelector,
  shouldBeDisabled,
  startAs,
  switchTo,
  verifyAndExpect,
} from '../../support/missions';

// The document hash is read from the fixture file (the demo spec fixes only its shape, de00 + 60 hex, A24).
const D01_SHA256 = documents.find((d) => d.id === 'D01')?.sha256 ?? '';

describe('M8: archive and fast-forward five years', () => {
  missionAtEachViewport('archive D01, D02 cannot be archived, +5 years deletes the file but keeps the SHA-256 in the audit log', () => {
    expect(D01_SHA256, 'D01 sha256 from fixtures').to.match(/^de00[0-9a-f]{60}$/);

    startAs('u-somchai');
    expectMissionDone('M8', false);

    // --- archive a TOTAL-PASSED document ---
    verifyAndExpect('D01', GOLDEN.D01);
    cy.tid(TID.result.archiveAdd).should('not.be.disabled').click();
    gotoPage('archive', ROUTES.archive);
    const rows = rowSelector(TID.archive.row);
    cy.get(rows).should('have.length', 1).first().should('have.attr', 'data-state', 'archived');

    // --- only TOTAL-PASSED results can be archived (A16) ---
    openResultOf('D02');
    cy.tid(TID.result.archiveAdd).should(shouldBeDisabled);

    // --- five years later: deleted, only hash + metadata remain ---
    cy.advanceClock('P5Y');
    gotoPage('archive', ROUTES.archive);
    cy.get(rows).first().should('have.attr', 'data-state', 'deleted').and('contain.text', D01_SHA256);

    // --- mails: 30-day notice and deletion notice ---
    gotoPage('mailbox', ROUTES.mailbox);
    cy.tid(TID.mailbox.list)
      .should('contain.text', 'เอกสารในคลังจะครบ 5 ปีใน 30 วัน')
      .and('contain.text', 'เอกสารในคลังถูกลบแล้ว');

    // --- admin-a: the audit log keeps the deletion with the SHA-256 ---
    switchTo('a-admin-a');
    gotoPage('adminStatus', ROUTES.adminStatus);
    cy.tid(TID.adminStatus.auditTable).should('contain.text', 'archive.deleted').and('contain.text', D01_SHA256);

    expectMissionDone('M8', true);
  });
});
