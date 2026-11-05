-- Division Head / SOA "My Clients" and the daily caps look up inquiries by data->>'ownerId'; index it so they do not scan
-- the whole inquiries table as volume grows.
set local search_path = rmc2;

create index if not exists inquiries_owner on rmc2.inquiries ((data->>'ownerId')) where (data->>'ownerId') is not null;
