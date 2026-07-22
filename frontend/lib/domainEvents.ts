export const PRIMARY_DOMAIN_CHANGED_EVENT = "arclend:primary-domain-changed";

export type PrimaryDomainChangedDetail = {
  address: string;
  domain: string | null;
};

export function announcePrimaryDomainChanged(
  address: string,
  domain: string | null,
) {
  window.dispatchEvent(
    new CustomEvent<PrimaryDomainChangedDetail>(PRIMARY_DOMAIN_CHANGED_EVENT, {
      detail: { address, domain },
    }),
  );
}
