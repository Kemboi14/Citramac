from celery import shared_task

from .sync import sync_terminology_source


@shared_task
def sync_icd11():
    run = sync_terminology_source("ICD11")
    return str(run.id)


@shared_task
def sync_loinc():
    run = sync_terminology_source("LOINC")
    return str(run.id)


@shared_task
def sync_national_drug_index():
    run = sync_terminology_source("NATIONAL_DRUG_INDEX")
    return str(run.id)
