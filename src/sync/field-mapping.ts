import { InstantlyLead } from '../instantly/client';

/**
 * Maps Instantly.ai lead data to Day.ai contact standard properties.
 * Only includes fields that have non-empty values.
 */
export function mapLeadToContactProperties(lead: InstantlyLead): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  if (lead.email) props.email = lead.email;
  if (lead.first_name) props.firstName = lead.first_name;
  if (lead.last_name) props.lastName = lead.last_name;
  if (lead.company_name) props.currentCompanyName = lead.company_name;
  if (lead.phone) props.primaryPhoneNumber = lead.phone;

  // Map custom variables to standard fields where possible
  const cv = lead.custom_variables || {};

  if (cv.location) props.location = String(cv.location);
  if (cv.city) props.city = String(cv.city);
  if (cv.state) props.state = String(cv.state);
  if (cv.country) props.country = String(cv.country);
  if (cv.title || cv.job_title) props.currentJobTitle = String(cv.title || cv.job_title);
  if (cv.linkedin_url || cv.linkedInUrl) {
    props.linkedInUrl = String(cv.linkedin_url || cv.linkedInUrl);
  }

  return props;
}

/**
 * Extracts Instantly custom variables that should become Day.ai custom properties
 * on the opportunity. Returns only non-empty values.
 */
export function mapLeadToOpportunityCustomProps(
  lead: InstantlyLead
): Array<{ propertyId: string; value: unknown }> {
  const customs: Array<{ propertyId: string; value: unknown }> = [];
  const cv = lead.custom_variables || {};

  // These custom fields will be created in Day.ai during setup
  const fieldMappings: Record<string, string> = {
    district: 'instantly_district',
    number_of_students: 'instantly_number_of_students',
    numberOfStudents: 'instantly_number_of_students',
    source: 'instantly_lead_source',
    lead_source: 'instantly_lead_source',
    location: 'instantly_location',
  };

  for (const [instantlyKey, dayPropertyId] of Object.entries(fieldMappings)) {
    const val = cv[instantlyKey];
    if (val !== undefined && val !== null && val !== '') {
      // Avoid adding duplicate property IDs
      if (!customs.find((c) => c.propertyId === dayPropertyId)) {
        customs.push({ propertyId: dayPropertyId, value: val });
      }
    }
  }

  // Pass through any remaining custom variables with an instantly_ prefix
  for (const [key, val] of Object.entries(cv)) {
    if (val === undefined || val === null || val === '') continue;
    if (key in fieldMappings) continue; // Already mapped
    const propertyId = `instantly_${key}`;
    if (!customs.find((c) => c.propertyId === propertyId)) {
      customs.push({ propertyId: propertyId, value: val });
    }
  }

  return customs;
}

/**
 * Build a deal title from lead data.
 */
export function buildDealTitle(lead: InstantlyLead): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email;
  const company = lead.company_name || lead.custom_variables?.district || '';
  if (company) {
    return `${name} - ${company} (Willow Education)`;
  }
  return `${name} (Willow Education)`;
}

/**
 * Build a deal description from lead data.
 */
export function buildDealDescription(lead: InstantlyLead): string {
  const lines: string[] = [
    `Lead sourced from Instantly.ai email campaign.`,
    `Campaign: ${lead.campaign || 'klaviyo cleaned sup, CAO list Dec 2025'}`,
    `Email opens: ${lead.email_open_count || 1}`,
  ];

  if (lead.email_reply_count > 0) {
    lines.push(`Email replies: ${lead.email_reply_count}`);
  }

  const cv = lead.custom_variables || {};
  if (cv.district) lines.push(`District: ${cv.district}`);
  if (cv.number_of_students || cv.numberOfStudents) {
    lines.push(`Number of Students: ${cv.number_of_students || cv.numberOfStudents}`);
  }
  if (cv.source || cv.lead_source) {
    lines.push(`Source: ${cv.source || cv.lead_source}`);
  }

  return lines.join('\n');
}
