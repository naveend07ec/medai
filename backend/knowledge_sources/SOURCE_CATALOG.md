# Verified Medical Knowledge Base — Source Catalog

**Project:** Reimagining Healthcare with Generative AI: Personalized Diagnosis and Treatment (27CSPS028)  
**Directory:** `backend/knowledge_sources/`  
**Last Verified:** 2026-11-12

All documents below were sourced from official government health bodies, international health authorities (WHO, ICMR, NIH/NLM), or NHS clinical commissioning guidelines, verified for file integrity and extractable text, and kept unmodified in their original form (PDF) or verbatim extracted official text (MD).

---

## 1. Verified & Downloaded Documents

| Document | Category | Publisher | Publication Date | Source URL | Local Path | Format | Verification | Notes |
|---|---|---|---|---|---|---|---|---|
| Standard Treatment Workflow (STW) for Management of Acute Respiratory Infection in Adults | Respiratory | Indian Council of Medical Research (ICMR) | 2024 (STW Series) | https://www.icmr.gov.in/icmrobject/uploads/STWs/1725963734_pulmonology_acute_respiratory_infections.pdf | `backend/knowledge_sources/respiratory/icmr_acute_respiratory_infections_adults.pdf` | PDF | Verified PDF, 1 page, 1,739,946 bytes, 7,462 extracted chars | Covers adult ARI, cough, fever, and inpatient Community-Acquired Pneumonia (CAP) pathways. |
| Standard Treatment Workflow (STW) for the Management of Asthma (ICD-10-J45) | Respiratory | Indian Council of Medical Research (ICMR) | 2024 (STW Series) | https://www.icmr.gov.in/icmrobject/uploads/STWs/1725952329_pulmonology_asthma.pdf | `backend/knowledge_sources/respiratory/icmr_asthma_adults.pdf` | PDF | Verified PDF, 1 page, 787,598 bytes, 6,015 extracted chars | Covers asthma diagnosis, differential vs. COPD/infection, and escalation. |
| Standard Treatment Workflow (STW) for the Management of Chronic Obstructive Pulmonary Disease (COPD) | Respiratory | Indian Council of Medical Research (ICMR) | 2024 (STW Series) | https://www.icmr.gov.in/icmrobject/uploads/STWs/1725952329_pulmonology_chronic_obstructive_pulmonary_disease.pdf | `backend/knowledge_sources/respiratory/icmr_copd_adults.pdf` | PDF | Verified PDF, 1 page, 1,033,006 bytes, 6,546 extracted chars | Covers adult COPD assessment, bronchodilator escalation, and referral criteria. |
| Standard Treatment Workflow (STW) for the Management of Respiratory Failure | Respiratory | Indian Council of Medical Research (ICMR) | 2024 (STW Series) | https://www.icmr.gov.in/icmrobject/uploads/STWs/1725952328_pulmonology_respiratory_failure.pdf | `backend/knowledge_sources/respiratory/icmr_respiratory_failure.pdf` | PDF | Verified PDF, 1 page, 829,086 bytes, 4,375 extracted chars | Covers hypoxia (`SpO2 < 90%`), oxygen therapy, and emergency referral. |
| Pulse Oximetry Training Manual | Respiratory | World Health Organization (WHO) — Patient Safety | 2011 | https://cdn.who.int/media/docs/default-source/patient-safety/pulse-oximetry/who-ps-pulse-oxymetry-training-manual-en.pdf?sfvrsn=322cb7ae_6 | `backend/knowledge_sources/respiratory/who_pulse_oximetry_training_manual.pdf` | PDF | Verified PDF, 24 pages, 1,005,192 bytes, 45,153 extracted chars | Comprehensive WHO training manual on `SpO2` physiology, hypoxaemia thresholds, and pulse oximetry pitfalls. |
| Interim Guidance on the Use of Pulse Oximetry in Monitoring COVID-19 Patients Under Home-Based Isolation and Care | Respiratory | World Health Organization (WHO) — AFRO | April 2021 | https://www.afro.who.int/sites/default/files/Covid-19/Techinical%20documents/GUIDELINES%20FOR%20THE%20USE%20OF%20PULSE%20OXIMETRY%20IN%20MONITORING%20COVID-19%20PATIENTS%20IN%20HBIC.pdf | `backend/knowledge_sources/respiratory/who_pulse_oximetry_home_monitoring.pdf` | PDF | Verified PDF, 5 pages, 317,426 bytes, 5,518 extracted chars | Concise guidance on home/community `SpO2` thresholds and red-flag escalation. |
| Standard Treatment Workflow (STW): Hypertension in Adults | Cardiovascular | Indian Council of Medical Research (ICMR) | 2024–2026 (STW Final) | https://www.icmr.gov.in/icmrobject/uploads/STWs/1778941063_hypertensioninadults_final.pdf | `backend/knowledge_sources/cardiovascular/icmr_hypertension_adults.pdf` | PDF | Verified PDF, 1 page, 3,297,566 bytes, 8,090 extracted chars | Covers adult blood pressure classification, risk factors, hypertensive urgency/emergency, and management. |
| Standard Treatment Workflow (STW): Cardiology (STEMI / Acute Coronary Syndrome) | Cardiovascular | Indian Council of Medical Research (ICMR) | 2025–2026 (STW) | https://www.icmr.gov.in/icmrobject/uploads/STWs/1768823342_cardiology_1-5.pdf | `backend/knowledge_sources/cardiovascular/icmr_stemi_acute_coronary.pdf` | PDF | Verified PDF, 1 page, 343,498 bytes, 6,798 extracted chars | Covers acute chest pain/STEMI emergency evaluation, troponin/ECG, and immediate escalation. |
| Standard Treatment Workflow (STW): Diabetes Mellitus Type 2 (ICD-10-E11) | Diabetes & Endocrine | Indian Council of Medical Research (ICMR) | 2024 (STW Series) | https://www.icmr.gov.in/icmrobject/uploads/STWs/1726567245_diabetes_mellitus_type_2.pdf | `backend/knowledge_sources/diabetes_endocrine/icmr_type2_diabetes_stw.pdf` | PDF | Verified PDF, 1 page, 332,368 bytes, 5,103 extracted chars | Complements existing NIDDK reference; covers diagnostic thresholds, HbA1c targets, and complications. |
| Point of Care C-Reactive Protein (CRP) Testing in Primary Care for Patients with Lower Respiratory Tract Infections | Laboratory | NHS Shropshire, Telford and Wrekin CCG | November 2016 | https://www.shropshiretelfordandwrekinccg.nhs.uk/wp-content/uploads/CRP-Point_of_Care_Testing_in_Primary_Care_guideline_Nov_16.pdf | `backend/knowledge_sources/laboratory/nhs_shropshire_crp_rti_guidance.pdf` | PDF | Verified PDF, 3 pages, 442,314 bytes, 6,054 extracted chars | Provides evidence-based CRP thresholds (`<20`, `20–100`, `>100 mg/L`) for cough/LRTI clinical decisions. |
| White Blood Count (WBC) — MedlinePlus Medical Test Guide | Laboratory | National Library of Medicine (NLM) / NIH MedlinePlus | Current web edition (retrieved 2026-11-12) | https://medlineplus.gov/lab-tests/white-blood-count-wbc/ | `backend/knowledge_sources/laboratory/nih_medlineplus_white_blood_count_wbc.md` | MD | Verified verbatim text extraction, 12,133 chars | Covers WBC types, high/low WBC interpretation, infection/inflammation context, and limitations. |
| Interagency Integrated Triage Tool: Age ≥ 12 | General Clinical | WHO / ICRC / MSF | March 2020 | https://cdn.who.int/media/docs/default-source/integrated-health-services-(ihs)/csy/iitt/iitt_adult.pdf?sfvrsn=b2a91431_1 | `backend/knowledge_sources/general_clinical/who_iitt_triage_adults_over12.pdf` | PDF | Verified PDF, 1 page, 53,006 bytes, 2,194 extracted chars | Covers adult high-risk vital sign thresholds (HR, RR, Temp, SpO2, AVPU) and red-flag escalation. |

### Pre-existing Knowledge Base Document (Preserved)
- **NIDDK Diabetes Tests & Diagnosis Guidelines** (`niddk_diabetes_tests_diagnosis.md`, ID `4f901561-0b07-4481-8d4a-9f157fa42ea7`, 3 chunks) — National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK), https://www.niddk.nih.gov/health-information/diabetes/overview/tests-diagnosis

---

## 2. Rejected / Failed Candidate Downloads

| Candidate | Official URL | Reason Rejected / Failed |
|---|---|---|
| WHO Guideline for the pharmacological treatment of hypertension in adults (2021) | https://iris.who.int/server/api/core/bitstreams/36edee5a-3586-4764-918c-4a075d7356fb/content | Returned `image/jpeg` (13.6 KB) instead of PDF bitstream; manual browser download from https://www.who.int/publications/i/item/9789240033986 if full 2021 book is desired. |
| WHO HEARTS-D: Diagnosis and management of type 2 diabetes (2020) | https://iris.who.int/bitstreams/2a0b4f68-7155-4ad1-b543-945791e31830/download | Returned HTML gate (`text/html`, 755 bytes) instead of PDF; covered via existing NIDDK reference + ICMR Type 2 Diabetes STW. |
| North Bristol NHS Trust — White Blood Count page | https://www.nbt.nhs.uk/severn-pathology/requesting/test-information/white-blood-count | HTML webpage rather than PDF; replaced with NIH MedlinePlus WBC guide. |
| Gloucestershire Hospitals NHS — CRP page | https://www.gloshospitals.nhs.uk/our-services/services-we-offer/pathology/tests-and-investigations/crp-c-reactive-protein/ | HTML webpage rather than PDF; replaced with NHS Shropshire CRP LRTI PDF. |
| ICMR STW: Dengue Fever | https://www.icmr.gov.in (STW Portal) | HTTP read timed out during download. |
| ICMR STW: Acute Undifferentiated Febrile Illness | https://www.icmr.gov.in (STW Portal) | HTTP read timed out during download. |

