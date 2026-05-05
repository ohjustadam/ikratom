-- Add city + county to profiles for matching local officials.
-- These are populated automatically from Census Geocoder on profile save.

alter table public.profiles
  add column if not exists city text,
  add column if not exists county text;
