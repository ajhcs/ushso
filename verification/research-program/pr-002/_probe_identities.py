#!/usr/bin/env python3
"""Temporary probe for PR-002 product identity resolution. Not a committed artifact."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CORPUS = ROOT / "packages/retrieval/versions/v1.2.0/corpus"


def load_rows():
    rows = []
    for stem in ("records-0001", "records-0002", "records-0003"):
        with (CORPUS / f"{stem}.jsonl").open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def rec(row):
    mf = row["identity"]["match_fields"]
    return {
        "record_id": row["record_id"],
        "title": row["title"],
        "source": row["identity"]["source"]["source_id"],
        "native": mf.get("source_id"),
        "url": row.get("authoritative_url") or mf.get("canonical_url"),
        "publisher": mf.get("publisher"),
        "access": row.get("access", {}).get("status"),
    }


def main() -> None:
    rows = load_rows()
    want_cms = [
        "Hospital Provider Cost Report",
        "Home Health Agency Cost Report",
        "Skilled Nursing Facility Cost Report",
        "Hospital All Owners",
        "Hospital Change of Ownership",
        "Hospital Change of Ownership - Owner Information",
        "Hospital Enrollments",
        "Skilled Nursing Facility All Owners",
        "Skilled Nursing Facility Change of Ownership",
        "Federally Qualified Health Center All Owners",
        "Home Health Agency All Owners",
        "Payroll Based Journal Daily Nurse Staffing",
        "Payroll Based Journal Daily Non-Nurse Staffing",
        "Payroll Based Journal Employee Detail Nursing Home Staffing",
        "Hospital Price Transparency Enforcement Activities and Outcomes",
        "Medicare Inpatient Hospitals - by Provider",
        "Medicare Inpatient Hospitals - by Provider and Service",
        "Medicare Outpatient Hospitals - by Provider and Service",
        "Hospital Service Area",
        "Medicare Geographic Variation - by National, State & County",
        "Medicare Geographic Variation - by Hospital Referral Region",
        "Medicare Monthly Enrollment",
        "Medicare Advantage Geographic Variation - National & State",
        "Health Insurance Exchanges Annual Effectuated Enrollment",
        "Medicaid Managed Care",
        "CMS Program Statistics - Medicare-Medicaid Dual Enrollment",
        "CMS Program Statistics - Medicare Part D Enrollment",
        "Monthly Prescription Drug Plan Formulary and Pharmacy Network Information",
        "Medicare Part B Spending by Drug",
        "Medicare Part D Spending by Drug",
        "Medicare Clinical Laboratory Fee Schedule Private Payer Rates and Volumes",
        "Medicaid Spending by Drug",
        "Quarterly Prescription Drug Plan Formulary, Pharmacy Network, and Pricing Information",
        "Medicare Part B Discarded Drug Units",
        "Physician/Supplier Procedure Summary",
        "Agency for Healthcare Research and Quality (AHRQ) Patient Safety Indicator 11 (PSI-11) Measure Rates",
        "Quality Payment Program Experience",
        "Nursing Home Chain Performance Measures",
        "Deficit Reduction Act Hospital-Acquired Condition Measures",
        "Medicare Dialysis Facilities",
        "Provider of Services File - Quality Improvement and Evaluation System",
        "Medicare Fee-For-Service Public Provider Enrollment",
        "Medicare Physician & Other Practitioners - by Provider",
        "Opioid Treatment Program Providers",
        "Order and Referring",
        "Market Saturation & Utilization State-County",
        "Medicare Home Health Patients and Visits by State",
        "Medicare COVID-19 Hospitalization Trends",
        "Medicare Post-Acute Care Utilization - Skilled Nursing Facility by Geography and Provider",
        "Facility-Level Minimum Data Set Frequency",
        "Performance Year Financial and Quality Results",
        "ACO REACH Financial and Quality Results",
        "County-level Aggregate Expenditure and Risk Score Data on Assignable Beneficiaries",
        "Medicare Current Beneficiary Survey - Survey File",
        "Medicare Current Beneficiary Survey - Cost Supplement",
        "Provider of Services File - Clinical Laboratories",
        "Rural Health Clinic Enrollments",
        "Skilled Nursing Facility Enrollments",
        "Federally Qualified Health Center Enrollments",
        "Medicare Telehealth Trends",
        "Innovation Center Model Summary Information",
        "CMS Program Statistics - Medicare Inpatient Hospital",
        "CMS Program Statistics - Medicare Total Enrollment",
        "Health Insurance Exchanges Monthly Effectuated Enrollment",
        "Medicare Geographic Variation - by Hospital Referral Region",
        "Income and Asset Ownership",
        "Minimum Data Set Frequency",
        "Long-Term Care Facility Characteristics",
        "Medicare Demonstrations",
        "Opt Out Affidavits",
        "Revoked Medicare Providers and Suppliers",
        "Public Reporting of Missing Digital Contact Information",
        "Medicare Provider and Supplier Taxonomy Crosswalk",
        "Restructured BETOS Classification System",
        "Medicaid Opioid Prescribing Rates - by Geography",
        "Medicare Part D Opioid Prescribing Rates - by Geography",
        "Medicare Durable Medical Equipment, Devices & Supplies - by Geography and Service",
        "Hospital Price Transparency Enforcement Activities and Outcomes",
    ]
    by_title = {
        r["title"]: rec(r)
        for r in rows
        if r["identity"]["source"]["source_id"] == "cms-data-catalog"
    }
    missing = [t for t in want_cms if t not in by_title]
    print("CMS missing", missing)
    print("CMS found", len(set(want_cms) - set(missing)), "/", len(set(want_cms)))
    for title in sorted(set(want_cms) - set(missing)):
        item = by_title[title]
        print(f"CMS\t{item['native']}\t{item['record_id']}\t{title}")

    cdc_ids = [
        "e2d5-ggg7",
        "jqwm-z2g9",
        "pjb2-jvdr",
        "ddsk-zebd",
        "ypqf-r5qs",
        "9hdi-ekmb",
        "4q35-rqzk",
        "thir-stei",
        "ga7k-kycn",
        "rdjz-vn2n",
        "w26f-tf3h",
        "7aq9-prdf",
        "escb-scz6",
        "kgm3-tvmi",
        "i6u4-y3g4",
        "e539-uadk",
        "cwsq-ngmh",
        "duw2-7jbt",
        "373s-ayzu",
    ]
    print("\n=== CDC ===")
    for row in rows:
        native = row["identity"]["match_fields"].get("source_id")
        if native in cdc_ids:
            item = rec(row)
            print(json.dumps(item, indent=2))

    print("\n=== isolated ===")
    for row in rows:
        desc = row.get("description")
        if not isinstance(desc, str) or not desc.strip():
            print(rec(row))

    census = [r for r in rows if r["identity"]["source"]["source_id"] == "census-api"]

    def strip(title: str) -> str:
        return re.sub(r"\b(19|20)\d{2}\b", "YEAR", title)

    fam = defaultdict(list)
    for row in census:
        fam[strip(row["title"])].append(row)
    print("\n=== ACS families ===")
    for key, group in sorted(fam.items()):
        if "ACS" in key or "American Community" in key:
            natives = sorted({x["identity"]["match_fields"]["source_id"] for x in group})
            print(f"{len(group):3} {key[:110]}")
            print("    ", natives[:4], "...", natives[-1] if natives else "")


if __name__ == "__main__":
    main()
