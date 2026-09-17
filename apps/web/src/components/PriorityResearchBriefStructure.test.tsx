import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ACTIVE_CATALOG } from '../data/catalogMode'
import { PRIORITY_RESEARCH_QUESTIONS } from '../data/researchNavigator'
import { PriorityResearchBrief } from './PriorityResearchNavigator'

// Six-section brief structure tests for the enriched navigator.
// See docs/research-program/navigator-frontend-plan-20260917.md sections 2, 4, 7.
// The dictionary case targets the enriched SAHIE brief: documentation enrichment landed
// dictionary bindings on 10 profiles (sahie/places/brfss/maternal/infant/hcris/nppes/ahrf/meps/sheps-table),
// so non-enriched briefs (for example hospital-ownership) must honestly show fallback text instead of an invented link.
// Existing validators (researchNavigator, navigatorIntegration, catalogMode, modeSeparation)
// are untouched and must stay green.

function renderBrief(questionId: string) {
  const question = PRIORITY_RESEARCH_QUESTIONS.find((item) => item.id === questionId);
  if (!question) throw new Error('missing fixture question ' + questionId);
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ['/search?q=brief-structure'] },
      createElement(PriorityResearchBrief, { question })
    )
  );
}

const SECTION_ORDER = [
  'useful-for',
  'coverage',
  'available-info',
  'access',
  'limits',
  'evidence',
];

function sectionIndexes(markup: string) {
  return SECTION_ORDER.map((section) => markup.indexOf('data-brief-section="' + section + '"'));
}

describe('priority brief six-section structure (enrichment target)', () => {
  it.each(['hospital-finance-hcris', 'svi-social-vulnerability'])(
    'renders sections 1-6 in order for %s',
    (questionId) => {
      const markup = renderBrief(questionId);
      const indexes = sectionIndexes(markup);
      for (const [position, index] of indexes.entries()) {
        expect(index, SECTION_ORDER[position] + ' missing in ' + questionId).toBeGreaterThan(-1);
      }
      const ordered = [...indexes].sort((left, right) => left - right);
      expect(indexes).toEqual(ordered);
    }
  );

  it('keeps Available info with representative vars plus a dictionary link', () => {
    const markup = renderBrief('county-uninsured');
    const available = markup.indexOf('data-brief-section="available-info"');
    expect(available).toBeGreaterThan(-1);
    const after = markup.slice(available);
    expect(after).toContain('NIPR_PT');
    expect(after).toContain('data-dictionary-link');
    expect(after).toMatch(/data-dictionary-link[^>]*href="https:[^"]+"/);
  });

  it('shows honest fallback text instead of an invented dictionary link when unenriched', () => {
    // hospital-ownership (cms-chow) has no enrichment bindings; hcris gained a methodology link in batch 2.
    const markup = renderBrief('hospital-ownership');
    const available = markup.indexOf('data-brief-section="available-info"');
    expect(available).toBeGreaterThan(-1);
    const after = markup.slice(available);
    expect(after).toContain('No retained variable dictionary');
    expect(after).not.toContain('data-dictionary-link');
  });

  it('renders readable resolvable evidence links with expandable technical provenance', () => {
    // hospital-ownership exercises the publisher-page fallback; enriched briefs render evidenceLinks instead.
    const markup = renderBrief('hospital-ownership');
    const evidence = markup.indexOf('data-brief-section="evidence"');
    expect(evidence).toBeGreaterThan(-1);
    const after = markup.slice(evidence);
    expect(after).toMatch(/<a[^>]*href="https:[^"]+"[^>]*>/);
    expect(after).toContain('Publisher discovery page');
    const provenance = markup.indexOf('data-provenance="technical-ids"');
    expect(provenance).toBeGreaterThan(evidence);
    const beforeProvenance = markup.slice(0, provenance);
    expect(beforeProvenance).not.toContain('record:obs:asset');
    expect(beforeProvenance).not.toContain('registry:named-source-registry');
    expect(markup.slice(provenance)).toContain('record:obs:asset');
  });

  it('keeps the SVI name-collision warning visible in Limits, not only in facts', () => {
    const markup = renderBrief('svi-social-vulnerability');
    const limits = markup.indexOf('data-brief-section="limits"');
    expect(limits).toBeGreaterThan(-1);
    const after = markup.slice(limits);
    expect(after.toLowerCase()).toContain('similarly');
  });

  it('preserves packet download and mode-consistent catalog scope (preservation case)', () => {
    const markup = renderBrief('hospital-finance-hcris');
    expect(markup).toContain('Download evidence packet');
    expect(markup).toContain('data-priority-packet');
    expect(markup).toContain(ACTIVE_CATALOG.displayLabel);
  });
});
