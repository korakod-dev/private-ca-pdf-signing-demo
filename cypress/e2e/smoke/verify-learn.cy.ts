// Smoke for sub-task E (verify and learn pages): home, /verify, /verify/:jobId, /guide, /pki/status, /about, /policy,
// not-found. Every test runs at both viewports (1280 and 390) and passes axe (serious/critical).
// Selectors come only from TID, paths only from ROUTES. Test mode (cy.visitDemo): frozen clock, no latency.
import pki from '../../../src/fixtures/pki.json';
import { ROUTES } from '../../../src/contracts/routes';
import { SESSION_STORAGE_KEY } from '../../../src/contracts/store';
import { TID } from '../../../src/contracts/testids';

const ROOT_FINGERPRINT = pki.find((ca) => ca.id === 'root-2026')?.fingerprint_sha256 ?? '';

describe('verify-learn: static pages', () => {
  const PAGES = [
    { key: 'home', path: ROUTES.home },
    { key: 'about', path: ROUTES.about },
    { key: 'policy', path: ROUTES.policy },
    { key: 'notFound', path: '/no-such-page' },
  ] as const;

  PAGES.forEach(({ key, path }) => {
    it(`${key} renders one h1 and passes axe`, () => {
      cy.forEachViewport(() => {
        cy.visitDemo(path);
        cy.tid(TID.page(key)).should('exist');
        cy.get('h1').should('have.length', 1);
        cy.a11y();
      });
    });
  });

  it('home shows the service status and follows the fault toggles', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.home);
      cy.get('[data-service="ocsp"]').should('have.attr', 'data-state', 'up');
      cy.setFault('ocsp', true);
      cy.get('[data-service="ocsp"]').should('have.attr', 'data-state', 'down').and('contain.text', 'ล่ม');
      cy.a11y();
      cy.setFault('ocsp', false);
      cy.get('[data-service="ocsp"]').should('have.attr', 'data-state', 'up');
    });
  });

  it('about says feedback is not open yet', () => {
    cy.visitDemo(ROUTES.about);
    cy.contains('ยังไม่เปิดรับความเห็น').should('be.visible');
  });

  it('policy shows four demo-labelled documents with collapsed technical details', () => {
    cy.visitDemo(ROUTES.policy);
    cy.get('h2').should('have.length', 4).each(($h) => expect($h.text()).to.contain('ฉบับย่อสำหรับ demo'));
    cy.get('details').should('have.length', 4).each(($d) => expect($d.attr('open')).to.eq(undefined));
  });
});

describe('verify-learn: /verify', () => {
  it('lists the 12 samples and passes axe', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.verify);
      for (let n = 1; n <= 12; n++) cy.tid(TID.verify.sample(`D${String(n).padStart(2, '0')}`)).should('exist');
      cy.a11y();
    });
  });

  it('D01 ends on the result page: TOTAL-PASSED, why panel, raw JSON, .txt download', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.verify);
      cy.tid(TID.verify.sample('D01')).click();
      cy.location('pathname').should('match', /^\/verify\/job-\d+$/);
      cy.tid(TID.result.indication).should('have.attr', 'data-indication', 'TOTAL-PASSED');
      cy.tid(TID.result.code).should('have.attr', 'data-value', 'VALID');
      cy.tid(TID.result.questions).should('be.visible');
      cy.tid(TID.result.why).should('contain.text', 'CHAIN_TRUSTED');
      cy.tid(TID.result.rawToggle).click();
      cy.tid(TID.result.raw).should('contain.text', '"indication": "TOTAL-PASSED"');
      cy.tid(TID.result.download).should('have.attr', 'data-file-name', 'DEMO-report.txt');
      cy.tid(TID.result.reportPreview).should('contain.text', 'DEMO — ไม่ใช่ผลตรวจจริง');
      // F25: `contain.text` also passes when the text is cropped, so check the geometry: the rotated watermark text (SVG
      // text bounding box in viewport coordinates) lies fully inside the watermarked block, at 1280 and 390 px.
      // Font-independent: no hard-coded margin. The only reference is the block's own box (the SVG fills it), with a small
      // tolerance for sub-pixel rounding; the Linux CI font (wider than macOS) must not change the outcome, which the
      // component guarantees with `textLength` (fixed drawn width) instead of relying on font metrics.
      const TOLERANCE_PX = 2;
      cy.tid(TID.result.reportPreview).find('[data-testid="watermark"]').scrollIntoView();
      cy.tid(TID.result.reportPreview).find('[data-testid="watermark"]').should(($block) => {
        const box = $block[0]!.getBoundingClientRect();
        const text = $block.find('[data-testid="watermark-text"]')[0]!.getBoundingClientRect();
        expect(text.width, 'watermark text is drawn').to.be.greaterThan(50);
        expect(text.left, 'text left edge').to.be.gte(box.left - TOLERANCE_PX);
        expect(text.right, 'text right edge').to.be.lte(box.right + TOLERANCE_PX);
        expect(text.top, 'text top edge').to.be.gte(box.top - TOLERANCE_PX);
        expect(text.bottom, 'text bottom edge').to.be.lte(box.bottom + TOLERANCE_PX);
      });
      cy.a11y();
    });
  });

  it('D02 fails as MODIFIED and cannot be archived', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.verify);
      cy.tid(TID.verify.sample('D02')).click();
      cy.tid(TID.result.indication).should('have.attr', 'data-indication', 'TOTAL-FAILED');
      cy.tid(TID.result.code).should('have.attr', 'data-value', 'MODIFIED');
      cy.tid(TID.result.archiveAdd).should('be.disabled');
      cy.a11y();
    });
  });

  it('a signed-in persona can add a TOTAL-PASSED result to the archive (button locks afterwards)', () => {
    cy.visitDemo(ROUTES.verify);
    cy.switchPersona('u-somchai');
    cy.visitDemo(ROUTES.verify); // reload: the session token survives in localStorage
    cy.tid(TID.verify.sample('D01')).click();
    cy.tid(TID.result.indication).should('have.attr', 'data-indication', 'TOTAL-PASSED');
    cy.tid(TID.result.archiveAdd).should('not.be.disabled').click();
    cy.contains('เก็บเข้าคลังแล้ว').should('be.visible');
    cy.tid(TID.result.archiveAdd).should('be.disabled');
  });

  it('D06 explains the mixed-trust warning; D09 explains the missing signer', () => {
    cy.visitDemo(ROUTES.verify);
    cy.tid(TID.verify.sample('D06')).click();
    cy.tid(TID.result.warnings).should('contain.text', 'MIXED_TRUST');
    cy.tid(TID.result.subIndication).should('have.attr', 'data-value', 'NO_CERTIFICATE_CHAIN_FOUND');
    cy.visitDemo(ROUTES.verify);
    cy.tid(TID.verify.sample('D09')).click();
    cy.tid(TID.result.indication).should('have.attr', 'data-indication', 'TOTAL-PASSED');
    cy.tid(TID.result.warnings).should('contain.text', 'NO_SIGNER');
  });

  it('OCSP and CRL down: D01 becomes INDETERMINATE / TRY_LATER with an explanation', () => {
    cy.visitDemo(ROUTES.verify);
    cy.setFault('ocsp-crl', true);
    cy.tid(TID.verify.sample('D01')).click();
    cy.tid(TID.result.indication).should('have.attr', 'data-indication', 'INDETERMINATE');
    cy.tid(TID.result.subIndication).should('have.attr', 'data-value', 'TRY_LATER');
    cy.tid(TID.result.why).should('contain.text', 'REVOCATION_UNAVAILABLE');
    cy.a11y();
  });

  it('D10 is refused with 422 and D11 with 413, in Thai', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.verify);
      cy.tid(TID.verify.sample('D10')).click();
      cy.tid(TID.verify.error).should('have.attr', 'data-status', '422').and('contain.text', 'เข้ารหัส');
      cy.a11y();
      cy.tid(TID.verify.sample('D11')).click();
      cy.tid(TID.verify.error).should('have.attr', 'data-status', '413').and('contain.text', 'เกินกำหนด');
    });
  });

  it('an uploaded file is not read: the page explains that the demo cannot check real files', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.verify);
      cy.tid(TID.verify.upload).selectFile(
        { contents: Cypress.Buffer.from('%PDF-1.7 pretend'), fileName: 'mine.pdf', mimeType: 'application/pdf' },
        { force: true },
      );
      cy.tid(TID.verify.uploadNotice).should('contain.text', 'ระบบจำลองตรวจไฟล์จริงไม่ได้ เลือกเอกสารตัวอย่างแทน');
      cy.tid(TID.verify.upload).should(($input) => expect(($input[0] as HTMLInputElement).value).to.eq(''));
      cy.a11y();
    });
  });

  it('an unknown job id is explained, not a crash', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.verifyResult('job-9999'));
      cy.tid(TID.verify.error).should('have.attr', 'data-status', '404');
      cy.a11y();
    });
  });
});

describe('verify-learn: /guide', () => {
  it('fingerprint practice: a wrong value does not match, the right one does', () => {
    expect(ROOT_FINGERPRINT, 'root fingerprint from the fixture').to.match(/^DE:M0:/);
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.guide);
      cy.tid(TID.guide.fpCheck).should('not.be.disabled');
      cy.tid(TID.guide.fpInput).type(`${ROOT_FINGERPRINT.slice(0, -1)}F`, { delay: 0 });
      cy.tid(TID.guide.fpCheck).click();
      cy.tid(TID.guide.fpResult).should('have.attr', 'data-match', 'false');
      cy.tid(TID.guide.fpInput).clear().type(ROOT_FINGERPRINT, { delay: 0 });
      cy.tid(TID.guide.fpCheck).click();
      cy.tid(TID.guide.fpResult).should('have.attr', 'data-match', 'true');
      cy.a11y();
    });
  });

  it('shows the illustrated install steps for Keychain and Adobe', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.guide);
      cy.get('ol[aria-label="ขั้นตอนติดตั้งใน Keychain"] li').should('have.length', 4);
      cy.get('ol[aria-label="ขั้นตอนติดตั้งใน Adobe"] li').should('have.length', 4);
      cy.a11y();
    });
  });
});

describe('verify-learn: /pki/status', () => {
  it('shows the CRL and answers an OCSP query', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.pkiStatus);
      cy.tid(TID.pki.crlNumber).should('exist');
      cy.tid(TID.pki.crlNextUpdate).should('contain.text', '+07:00');
      cy.tid(TID.pki.crlEntries).should('exist');
      cy.tid(TID.pki.ocspInput).type('DE:M0:4F:2A:91:01');
      cy.tid(TID.pki.ocspQuery).click();
      cy.tid(TID.pki.ocspResult).should('have.attr', 'data-status', 'good');
      cy.tid(TID.pki.r14Warning).should('not.exist');
      cy.a11y();
    });
  });

  it('explains a CRL outage', () => {
    cy.visitDemo(ROUTES.pkiStatus);
    cy.setFault('crl', true);
    cy.contains('บริการ CRL ล่ม').should('be.visible');
    cy.tid(TID.pki.crlNumber).should('not.exist');
    cy.a11y();
  });
});

describe('verify-learn: R14 window against the real engine', () => {
  const SERIAL = 'DE:M0:4F:2A:91:01';

  it('shows the R14 warning after a self-revocation, and it clears when the next CRL is issued', () => {
    cy.visitDemo(ROUTES.pkiStatus);
    cy.switchPersona('u-somchai');
    // Revoke through the API directly: the lifecycle pages belong to another sub-task, the API is the same either way.
    cy.window().then((win) => {
      const token = win.localStorage.getItem(SESSION_STORAGE_KEY);
      return win.fetch(`/api/v1/certs/${encodeURIComponent(SERIAL)}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'cessationOfOperation' }),
      });
    });
    cy.visitDemo(ROUTES.pkiStatus);
    cy.tid(TID.pki.crlNumber).should('exist');
    cy.tid(TID.pki.ocspInput).type(SERIAL, { delay: 0 });
    cy.tid(TID.pki.ocspQuery).click();
    cy.tid(TID.pki.ocspResult).should('have.attr', 'data-status', 'revoked');
    cy.tid(TID.pki.r14Warning).should('be.visible');
    cy.tid(TID.pki.crlEntries).should('not.contain.text', SERIAL); // the published CRL does not list it yet
    cy.a11y();

    // The next 06:00 CRL lists the serial: both sources agree and the warning disappears (data reloads on the clock advance).
    cy.advanceClock('P1D');
    cy.tid(TID.pki.crlEntries).should('contain.text', SERIAL);
    cy.tid(TID.pki.r14Warning).should('not.exist');
  });
});
