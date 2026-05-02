--
-- PostgreSQL database dump
--

\restrict llMEOhLBw8ZmFXE8WKTTXiykqOm2EqSYFeFdPNZp1Jb4lzNH3K5McXT8dRAc9vN

-- Dumped from database version 16.13 (Homebrew)
-- Dumped by pg_dump version 16.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.scans DROP CONSTRAINT IF EXISTS scans_scanner_id_scanners_id_fk;
ALTER TABLE IF EXISTS ONLY public.scans DROP CONSTRAINT IF EXISTS scans_frame_id_frames_id_fk;
ALTER TABLE IF EXISTS ONLY public.scanners DROP CONSTRAINT IF EXISTS scanners_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.rolls DROP CONSTRAINT IF EXISTS rolls_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.rolls DROP CONSTRAINT IF EXISTS rolls_film_stock_id_film_stocks_id_fk;
ALTER TABLE IF EXISTS ONLY public.rolls DROP CONSTRAINT IF EXISTS rolls_camera_id_cameras_id_fk;
ALTER TABLE IF EXISTS ONLY public.notes DROP CONSTRAINT IF EXISTS notes_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.notes DROP CONSTRAINT IF EXISTS notes_roll_id_rolls_id_fk;
ALTER TABLE IF EXISTS ONLY public.notes DROP CONSTRAINT IF EXISTS notes_frame_id_frames_id_fk;
ALTER TABLE IF EXISTS ONLY public.lenses DROP CONSTRAINT IF EXISTS lenses_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.frames DROP CONSTRAINT IF EXISTS frames_roll_id_rolls_id_fk;
ALTER TABLE IF EXISTS ONLY public.frames DROP CONSTRAINT IF EXISTS frames_lens_id_lenses_id_fk;
ALTER TABLE IF EXISTS ONLY public.film_stocks DROP CONSTRAINT IF EXISTS film_stocks_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.film_inventory DROP CONSTRAINT IF EXISTS film_inventory_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.film_inventory DROP CONSTRAINT IF EXISTS film_inventory_film_stock_id_film_stocks_id_fk;
ALTER TABLE IF EXISTS ONLY public.development_logs DROP CONSTRAINT IF EXISTS development_logs_roll_id_rolls_id_fk;
ALTER TABLE IF EXISTS ONLY public.cameras DROP CONSTRAINT IF EXISTS cameras_user_id_users_id_fk;
ALTER TABLE IF EXISTS ONLY public.camera_lenses DROP CONSTRAINT IF EXISTS camera_lenses_lens_id_lenses_id_fk;
ALTER TABLE IF EXISTS ONLY public.camera_lenses DROP CONSTRAINT IF EXISTS camera_lenses_camera_id_cameras_id_fk;
DROP INDEX IF EXISTS public.film_inventory_user_display_id_unique;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_unique;
ALTER TABLE IF EXISTS ONLY public.scans DROP CONSTRAINT IF EXISTS scans_pkey;
ALTER TABLE IF EXISTS ONLY public.scanners DROP CONSTRAINT IF EXISTS scanners_pkey;
ALTER TABLE IF EXISTS ONLY public.rolls DROP CONSTRAINT IF EXISTS rolls_pkey;
ALTER TABLE IF EXISTS ONLY public.notes DROP CONSTRAINT IF EXISTS notes_pkey;
ALTER TABLE IF EXISTS ONLY public.lenses DROP CONSTRAINT IF EXISTS lenses_pkey;
ALTER TABLE IF EXISTS ONLY public.frames DROP CONSTRAINT IF EXISTS frames_roll_id_frame_number_unique;
ALTER TABLE IF EXISTS ONLY public.frames DROP CONSTRAINT IF EXISTS frames_pkey;
ALTER TABLE IF EXISTS ONLY public.film_stocks DROP CONSTRAINT IF EXISTS film_stocks_pkey;
ALTER TABLE IF EXISTS ONLY public.film_inventory DROP CONSTRAINT IF EXISTS film_inventory_pkey;
ALTER TABLE IF EXISTS ONLY public.development_logs DROP CONSTRAINT IF EXISTS development_logs_roll_id_unique;
ALTER TABLE IF EXISTS ONLY public.development_logs DROP CONSTRAINT IF EXISTS development_logs_pkey;
ALTER TABLE IF EXISTS ONLY public.cameras DROP CONSTRAINT IF EXISTS cameras_pkey;
ALTER TABLE IF EXISTS ONLY public.camera_lenses DROP CONSTRAINT IF EXISTS camera_lenses_camera_id_lens_id_unique;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.scans;
DROP TABLE IF EXISTS public.scanners;
DROP TABLE IF EXISTS public.rolls;
DROP TABLE IF EXISTS public.notes;
DROP TABLE IF EXISTS public.lenses;
DROP TABLE IF EXISTS public.frames;
DROP TABLE IF EXISTS public.film_stocks;
DROP TABLE IF EXISTS public.film_inventory;
DROP TABLE IF EXISTS public.development_logs;
DROP TABLE IF EXISTS public.cameras;
DROP TABLE IF EXISTS public.camera_lenses;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: camera_lenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.camera_lenses (
    camera_id uuid NOT NULL,
    lens_id uuid NOT NULL
);


--
-- Name: cameras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cameras (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    format text NOT NULL,
    serial_number text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    frame_count integer
);


--
-- Name: development_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.development_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roll_id uuid NOT NULL,
    developer text NOT NULL,
    dilution text,
    dev_time_seconds integer,
    temperature_c numeric(4,1),
    agitation text,
    stop_bath text,
    fixer text,
    fixer_time_seconds integer,
    wash_method text,
    wetting_agent text,
    notes text,
    developed_at timestamp with time zone,
    results_rating integer,
    results_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: film_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.film_inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    film_stock_id uuid NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    expiration_date text,
    storage_location text DEFAULT 'fridge'::text NOT NULL,
    purchase_date text,
    cost_per_roll numeric(8,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    format text DEFAULT '35mm'::text NOT NULL,
    form text DEFAULT 'factory_roll'::text NOT NULL,
    remaining_length_ft numeric(8,1),
    original_length_ft numeric(8,1),
    frame_count integer,
    display_id text,
    rated_iso integer
);


--
-- Name: film_stocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.film_stocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    manufacturer text NOT NULL,
    name text NOT NULL,
    iso integer NOT NULL,
    type text NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    frame_count integer
);


--
-- Name: frames; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.frames (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roll_id uuid NOT NULL,
    frame_number integer NOT NULL,
    lens_id uuid,
    shutter_speed text,
    aperture text,
    compensation text,
    metering_mode text,
    subject text,
    notes text,
    latitude numeric(10,7),
    longitude numeric(10,7),
    location_name text,
    shot_at timestamp with time zone,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    rating integer,
    is_portfolio boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    focal_length_mm integer,
    max_aperture text,
    serial_number text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    roll_id uuid,
    frame_id uuid,
    type text,
    content text,
    file_key text,
    file_url text,
    thumbnail_url text,
    duration_seconds integer,
    mime_type text,
    file_size_bytes integer,
    latitude numeric(10,7),
    longitude numeric(10,7),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT note_parent_check CHECK (((roll_id IS NOT NULL) OR (frame_id IS NOT NULL)))
);


--
-- Name: rolls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rolls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    camera_id uuid,
    film_stock_id uuid NOT NULL,
    status text DEFAULT 'loaded'::text NOT NULL,
    loaded_at timestamp with time zone,
    rated_iso integer,
    push_pull_stops numeric(3,1),
    frame_count integer DEFAULT 36 NOT NULL,
    title text,
    description text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    format text DEFAULT '35mm'::text NOT NULL,
    form text DEFAULT 'factory_roll'::text NOT NULL,
    unloaded_at timestamp with time zone,
    display_id text
);


--
-- Name: scanners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scanners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    make text,
    model text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    frame_id uuid NOT NULL,
    scanner_id uuid,
    file_key text NOT NULL,
    file_url text NOT NULL,
    thumbnail_url text,
    original_filename text,
    mime_type text,
    file_size_bytes integer,
    width_px integer,
    height_px integer,
    dpi integer,
    bit_depth integer,
    color_space text,
    post_processing_notes text,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Data for Name: camera_lenses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.camera_lenses (camera_id, lens_id) FROM stdin;
\.


--
-- Data for Name: cameras; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cameras (id, user_id, make, model, format, serial_number, notes, is_active, created_at, updated_at, frame_count) FROM stdin;
bb587d3e-06d6-414f-808d-d700b4f8c2b5	c0fe3ff9-a993-4021-95f0-3f782e4038e0	Nikon	F3	35mm	\N	\N	t	2026-03-30 18:17:30.251062-07	2026-03-30 18:17:30.251062-07	\N
ecf85b27-a4e7-4233-b94e-06321e569c7f	d43eded1-69f1-427d-a695-70dbe56b69ef	Leica	M6	35mm	\N	\N	t	2026-03-30 19:19:29.383041-07	2026-03-30 19:19:29.383041-07	36
3916c853-860d-425c-a436-8560756da3cd	d43eded1-69f1-427d-a695-70dbe56b69ef	Mamiya	7	120	\N	\N	t	2026-04-11 15:41:57.267044-07	2026-04-11 15:41:57.267044-07	10
10424cc8-84ad-492a-a8e1-1171d3bd6c80	d43eded1-69f1-427d-a695-70dbe56b69ef	Graflex	Crown Graphic 4x5	4x5	\N	\N	t	2026-04-11 15:41:57.267044-07	2026-04-11 15:41:57.267044-07	1
40a57744-5a31-4dd3-b322-97f283f2dc64	d43eded1-69f1-427d-a695-70dbe56b69ef	Intrepid	4x5	4x5	\N	\N	t	2026-04-11 15:41:57.267044-07	2026-04-11 15:41:57.267044-07	1
8e9e496e-283e-481a-8822-d19f64eef741	d43eded1-69f1-427d-a695-70dbe56b69ef	Nikon	F3	35mm	\N	\N	t	2026-04-11 15:41:57.267044-07	2026-04-11 15:41:57.267044-07	36
\.


--
-- Data for Name: development_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.development_logs (id, roll_id, developer, dilution, dev_time_seconds, temperature_c, agitation, stop_bath, fixer, fixer_time_seconds, wash_method, wetting_agent, notes, developed_at, results_rating, results_notes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: film_inventory; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.film_inventory (id, user_id, film_stock_id, quantity, expiration_date, storage_location, purchase_date, cost_per_roll, notes, created_at, updated_at, format, form, remaining_length_ft, original_length_ft, frame_count, display_id, rated_iso) FROM stdin;
e29be6c1-b0ac-4866-9f47-1020bcb5987a	c0fe3ff9-a993-4021-95f0-3f782e4038e0	a30739bc-efc7-479f-a250-1f093df8f73b	5	2027-06	fridge	\N	\N	\N	2026-03-30 18:18:15.525215-07	2026-03-30 18:18:15.525215-07	35mm	factory_roll	\N	\N	\N	\N	\N
e4664165-7a78-41fc-9d5e-33d77829f1fb	d43eded1-69f1-427d-a695-70dbe56b69ef	8fa17252-6af5-4a06-a68a-3d5e88643e05	1	\N	fridge	\N	\N	Partially shot: 3 frames previously exposed, then rolled back into cassette with leader not retrieved. Before reloading: fish the leader, and advance an extra 4-5 frames to avoid overlap with the old exposures. Remaining usable: ~33 frames.	2026-04-11 17:54:55.195542-07	2026-04-11 17:54:55.218-07	35mm	factory_roll	\N	\N	33	R006	\N
6853b110-6edb-4335-8f22-641d03b87742	d43eded1-69f1-427d-a695-70dbe56b69ef	ac6d943d-46ba-404f-bbc0-54f0a5f12cdc	1	\N	fridge	\N	\N	Rolled back into cassette with leader not retrieved. Unshot. Fish leader before reloading.	2026-04-11 17:56:31.599967-07	2026-04-11 17:56:31.622-07	35mm	factory_roll	\N	\N	\N	R007	\N
7180d050-760b-41a1-95e7-45a7ba945fba	d43eded1-69f1-427d-a695-70dbe56b69ef	bd77c711-8ca6-4b25-9a59-edf4513fb6f1	1	\N	fridge	\N	\N	\N	2026-04-11 16:16:25.867999-07	2026-04-11 16:16:25.867999-07	35mm	factory_roll	\N	\N	\N	\N	\N
a3822a4d-10d5-4dca-b716-152780034b48	d43eded1-69f1-427d-a695-70dbe56b69ef	ed42bb5c-f728-4dcc-8351-36578fbc7563	2	\N	fridge	\N	\N	\N	2026-04-11 16:18:33.656094-07	2026-04-11 16:18:33.656094-07	35mm	factory_roll	\N	\N	\N	\N	\N
4f678e2c-19db-47a4-8323-de399607a42f	d43eded1-69f1-427d-a695-70dbe56b69ef	42f44ce0-b4a1-45f4-835d-7845d983bb2b	1	\N	fridge	\N	\N	\N	2026-04-11 16:23:31.858326-07	2026-04-11 16:23:31.858326-07	35mm	factory_roll	\N	\N	\N	\N	\N
1f9e6e84-0265-4403-8147-8fd99e5cf85b	d43eded1-69f1-427d-a695-70dbe56b69ef	e388e75a-5ca1-447f-adb9-0358ab3e8671	1	\N	fridge	\N	\N	\N	2026-04-11 16:23:31.886553-07	2026-04-11 16:23:31.886553-07	35mm	factory_roll	\N	\N	\N	\N	\N
97294346-4de8-4ee2-9c70-a499c8492655	d43eded1-69f1-427d-a695-70dbe56b69ef	a1a136a7-d66a-46cd-9433-ff106fe3f3b9	1	\N	fridge	\N	\N	\N	2026-04-11 16:23:31.893264-07	2026-04-11 16:23:31.893264-07	35mm	factory_roll	\N	\N	\N	\N	\N
81c13197-9c0d-4580-b1a0-9f5177eec029	d43eded1-69f1-427d-a695-70dbe56b69ef	dafa9ff9-bd57-4a11-b77e-09ffe83f3e78	1	\N	fridge	\N	\N	\N	2026-04-11 16:23:31.920681-07	2026-04-11 16:23:31.920681-07	35mm	factory_roll	\N	\N	\N	\N	\N
7b02b4f4-41b8-40bd-9fcd-ed24dce5df18	d43eded1-69f1-427d-a695-70dbe56b69ef	aee798ee-c90b-43dd-a85a-57b795d33dfd	1	\N	fridge	\N	\N	bulk-spooled cassette	2026-04-11 16:26:52.692649-07	2026-04-11 16:26:52.692649-07	35mm	factory_roll	\N	\N	10	\N	\N
e85c7bfc-cc01-4adb-8873-987e14596550	d43eded1-69f1-427d-a695-70dbe56b69ef	aee798ee-c90b-43dd-a85a-57b795d33dfd	1	\N	fridge	\N	\N	no box, unknown origin — might be factory, might be bulk-spooled	2026-04-11 16:31:09.695705-07	2026-04-11 16:40:19.011-07	35mm	factory_roll	\N	\N	\N	R001	\N
7492561c-80e6-49cb-bf63-1119574e5d1f	d43eded1-69f1-427d-a695-70dbe56b69ef	03ee0cb0-6259-4872-b69a-94ab31532599	2	\N	fridge	\N	\N	\N	2026-04-11 16:41:43.133465-07	2026-04-11 16:41:43.133465-07	35mm	factory_roll	\N	\N	\N	\N	\N
67e22e48-e992-469d-b559-3fbba0775d69	d43eded1-69f1-427d-a695-70dbe56b69ef	f070c495-d3dc-4666-ba4e-d4855df9aba9	1	\N	fridge	\N	\N	\N	2026-04-11 16:43:14.771302-07	2026-04-11 16:43:14.771302-07	35mm	factory_roll	\N	\N	\N	\N	\N
3521c517-f2f4-4c01-a9b8-dcb690ae5c8f	d43eded1-69f1-427d-a695-70dbe56b69ef	612da9ef-5796-4fe0-aba2-0ff83ba928ab	1	\N	fridge	\N	\N	\N	2026-04-11 17:19:57.938874-07	2026-04-11 17:19:57.938874-07	35mm	factory_roll	\N	\N	\N	\N	\N
ac3356c4-aed9-4898-83d8-6872b37148ad	d43eded1-69f1-427d-a695-70dbe56b69ef	4b8c6364-deb6-43d6-b735-cc96a8c6d214	1	2012-01	fridge	\N	\N	\N	2026-04-11 17:21:31.663822-07	2026-04-11 17:25:03.774-07	35mm	factory_roll	\N	\N	\N	\N	\N
eb6c5cbf-b52e-44de-a47e-31b7207111f6	d43eded1-69f1-427d-a695-70dbe56b69ef	97899da6-11a2-470a-b629-723b51930301	1	2012	fridge	\N	\N	\N	2026-04-11 17:25:57.208069-07	2026-04-11 17:25:57.208069-07	35mm	factory_roll	\N	\N	\N	\N	\N
2aac5126-5999-4ca1-9129-3935c2b609c7	d43eded1-69f1-427d-a695-70dbe56b69ef	3c467ec4-504b-4d0c-ac76-085fa11aa165	1	\N	fridge	\N	\N	\N	2026-04-11 17:26:45.727625-07	2026-04-11 17:26:45.727625-07	35mm	factory_roll	\N	\N	\N	\N	\N
695d8dc4-c495-4f02-9644-50932298380f	d43eded1-69f1-427d-a695-70dbe56b69ef	c9bb56da-6fe5-41a7-a87b-1dfde30cc5bd	1	\N	fridge	\N	\N	\N	2026-04-11 17:27:44.753014-07	2026-04-11 17:27:44.753014-07	35mm	factory_roll	\N	\N	\N	\N	\N
1957afdd-8f2c-45fd-9086-6cd2be00b9b2	d43eded1-69f1-427d-a695-70dbe56b69ef	fbfb3f3a-b396-4cbe-9717-b20ec744dd1b	1	\N	fridge	\N	\N	\N	2026-04-11 17:28:36.097581-07	2026-04-11 17:28:36.097581-07	35mm	factory_roll	\N	\N	\N	\N	\N
9987f14d-26b2-4151-b82a-63212fee0613	d43eded1-69f1-427d-a695-70dbe56b69ef	3818009d-c3de-40f1-82c9-c9f6f9413ede	1	1992	fridge	\N	\N	\N	2026-04-11 17:30:53.321673-07	2026-04-11 17:30:53.321673-07	35mm	factory_roll	\N	\N	\N	\N	\N
86962cd4-b6a2-486a-85d5-03d572513190	d43eded1-69f1-427d-a695-70dbe56b69ef	2cf48166-e27e-4d99-8a81-e51279b4e98f	1	\N	fridge	\N	\N	\N	2026-04-11 17:33:42.560815-07	2026-04-11 17:33:42.560815-07	35mm	factory_roll	\N	\N	\N	\N	\N
38bad597-f972-4884-be6b-42f0879083a4	d43eded1-69f1-427d-a695-70dbe56b69ef	068df7e1-8f30-4560-8f39-715b5106e643	1	\N	fridge	\N	\N	\N	2026-04-11 17:34:39.993771-07	2026-04-11 17:34:39.993771-07	35mm	factory_roll	\N	\N	\N	\N	\N
19016b68-ccb3-469d-a23e-38c2490f6b3f	d43eded1-69f1-427d-a695-70dbe56b69ef	3841ac74-2774-4cf6-8724-226bc4b6c83e	1	\N	fridge	\N	\N	\N	2026-04-11 17:36:18.161309-07	2026-04-11 17:36:18.161309-07	35mm	factory_roll	\N	\N	\N	\N	\N
f6ec594b-0e20-418c-8cf0-9fdeb37d4c87	d43eded1-69f1-427d-a695-70dbe56b69ef	1cb6a6be-de3d-4f20-9424-e1446f3bb9b4	1	2023	fridge	\N	\N	\N	2026-04-11 17:37:44.767779-07	2026-04-11 17:37:44.767779-07	35mm	factory_roll	\N	\N	\N	\N	\N
893c966b-b712-4453-b308-37095142b226	d43eded1-69f1-427d-a695-70dbe56b69ef	345b2a21-1905-4b17-9fb5-7f5d4ea95e7a	1	2023	fridge	\N	\N	\N	2026-04-11 17:38:48.707688-07	2026-04-11 17:38:48.707688-07	35mm	factory_roll	\N	\N	\N	\N	\N
0a048bb7-0003-41c9-b889-527f95a87d2f	d43eded1-69f1-427d-a695-70dbe56b69ef	ea1992e5-c396-45d0-a4a3-7e77cb30cd93	2	\N	fridge	\N	\N	\N	2026-04-11 17:40:08.270526-07	2026-04-11 17:40:08.270526-07	35mm	factory_roll	\N	\N	\N	\N	\N
f07273e2-4c11-42b7-b183-be0e2bc7a6c1	d43eded1-69f1-427d-a695-70dbe56b69ef	564b6bef-e10a-49f9-9013-aaf60040ed9f	2	2015	fridge	\N	\N	\N	2026-04-11 17:41:46.236723-07	2026-04-11 17:41:46.236723-07	35mm	factory_roll	\N	\N	\N	\N	\N
aa411c9c-05a5-4262-a8cb-e41838992ac6	d43eded1-69f1-427d-a695-70dbe56b69ef	42f44ce0-b4a1-45f4-835d-7845d983bb2b	1	\N	fridge	\N	\N	out of box, believed fresh and unshot but not certain	2026-04-11 17:43:43.117197-07	2026-04-11 17:43:43.141-07	35mm	factory_roll	\N	\N	\N	R002	\N
e205d50c-d8d8-43f4-a858-66bd37d3ea8f	d43eded1-69f1-427d-a695-70dbe56b69ef	a1a136a7-d66a-46cd-9433-ff106fe3f3b9	1	\N	fridge	\N	\N	unhoused, unknown expiration. User-rated at ISO 25.	2026-04-11 17:48:14.719015-07	2026-04-11 17:48:14.732-07	35mm	factory_roll	\N	\N	\N	R003	25
59a5a0ce-6bf3-47dc-9bf9-7ee43d9eb900	d43eded1-69f1-427d-a695-70dbe56b69ef	37b8cad4-d2ab-4ae2-a1cc-b8f36d2a99b1	1	1996	fridge	\N	\N	24-exposure roll, expired 1996, user-rated at ISO 100	2026-04-11 17:50:10.537248-07	2026-04-11 17:50:10.559-07	35mm	factory_roll	\N	\N	24	R004	100
94192812-d170-4c54-908b-66fafe4269b1	d43eded1-69f1-427d-a695-70dbe56b69ef	9ab33c20-cbbe-4613-9904-d61ee9d1718a	1	\N	fridge	\N	\N	bulk-spooled cassette, 24 frames	2026-04-11 17:51:49.68013-07	2026-04-11 17:51:49.702-07	35mm	factory_roll	\N	\N	24	R005	\N
0ad3dd5d-0aab-443e-9f4e-9bff16e58409	d43eded1-69f1-427d-a695-70dbe56b69ef	ea8830a4-12ed-4201-9991-446a25d173ee	1	1998	fridge	\N	\N	Mystery 20-exposure roll, hand-written ISO 400 on cassette, expired 1998. User-rated ISO 25 to compensate.	2026-04-11 18:03:30.725772-07	2026-04-11 18:03:30.747-07	35mm	factory_roll	\N	\N	20	R009	25
6eaaeeb0-adb6-47c5-a7a3-1a2e74fa482f	d43eded1-69f1-427d-a695-70dbe56b69ef	b28883e1-0938-4b04-b060-545bc4d21f66	1	\N	fridge	\N	\N	Rolled up in cassette, leader inside. Believed fresh/unshot.	2026-04-11 18:04:28.202838-07	2026-04-11 18:04:28.225-07	35mm	factory_roll	\N	\N	\N	R010	\N
04b03489-55df-4d6f-ad53-c65667edd084	d43eded1-69f1-427d-a695-70dbe56b69ef	d41801c0-113a-487e-bcef-35af2d89d079	1	\N	fridge	\N	\N	In a reused Kentmere 400 canister — NOT actually Kentmere 400. Best guess HP5 or FP4 based on feel/source. Fresh. Stand dev planned. Frame count uncertain (24?).	2026-04-11 18:07:56.671108-07	2026-04-11 18:07:56.692-07	35mm	factory_roll	\N	\N	24	R011	\N
05023095-a2ca-413e-9c44-605ea98f5565	d43eded1-69f1-427d-a695-70dbe56b69ef	01feb6be-5390-433a-88ce-6d57a97e73f9	1	\N	fridge	\N	\N	Very old, unknown stock. Stand dev in Rodinal. Unknown frame count.	2026-04-11 18:10:07.491257-07	2026-04-11 18:10:07.556-07	35mm	factory_roll	\N	\N	\N	R014	25
8d367275-8ed4-4e47-bd88-46752103c0ff	d43eded1-69f1-427d-a695-70dbe56b69ef	01feb6be-5390-433a-88ce-6d57a97e73f9	1	\N	fridge	\N	\N	Very old, unknown stock. Stand dev in Rodinal. Unknown frame count.	2026-04-11 18:10:07.515524-07	2026-04-11 18:10:07.515524-07	35mm	factory_roll	\N	\N	\N	R012	25
fffeb0a3-0c9f-4dae-8518-8a90881da9b0	d43eded1-69f1-427d-a695-70dbe56b69ef	01feb6be-5390-433a-88ce-6d57a97e73f9	1	\N	fridge	\N	\N	Very old, unknown stock. Stand dev in Rodinal. Unknown frame count.	2026-04-11 18:10:07.536222-07	2026-04-11 18:10:07.536222-07	35mm	factory_roll	\N	\N	\N	R013	25
4480714b-a6f6-43cb-a997-86a8383d4d7e	d43eded1-69f1-427d-a695-70dbe56b69ef	79fad1b7-75b1-42c2-a934-4b6557f2d2c3	1	\N	fridge	\N	\N	Rolled up in cassette, leader inside. Fish leader before reloading.	2026-04-11 18:17:39.337677-07	2026-04-11 18:17:39.359-07	35mm	factory_roll	\N	\N	\N	R015	\N
5faecf1d-bb59-4398-960f-fe7b8fd0c579	d43eded1-69f1-427d-a695-70dbe56b69ef	c6b4d18a-c0a3-4420-80e4-ab6e57b9739c	0	\N	fridge	\N	\N	\N	2026-04-11 16:23:31.827339-07	2026-05-01 20:28:59.936075-07	35mm	factory_roll	\N	\N	\N	\N	\N
ade71f34-d34f-42da-900c-83fa4a4e39c9	d43eded1-69f1-427d-a695-70dbe56b69ef	79fad1b7-75b1-42c2-a934-4b6557f2d2c3	0	\N	fridge	\N	\N	\N	2026-04-11 17:29:19.229121-07	2026-05-01 20:52:37.93144-07	35mm	factory_roll	\N	\N	\N	\N	\N
e437233e-1cd1-4755-a919-c3f5b94c63c0	d43eded1-69f1-427d-a695-70dbe56b69ef	f228f76e-d873-4eb5-8bac-cbe79fa0d422	0	\N	fridge	\N	\N	\N	2026-04-11 17:32:44.434066-07	2026-05-01 20:40:37.523105-07	35mm	factory_roll	\N	\N	\N	\N	\N
faec8699-58d8-433d-9a7b-c0b220b89d4d	d43eded1-69f1-427d-a695-70dbe56b69ef	81fff50e-94b7-4cc7-9c23-a1c2937bc82a	0	\N	fridge	\N	\N	In canister, no box. Possibly partially shot — treating as unshot, any double exposures are a feature.	2026-04-11 17:59:14.998544-07	2026-05-01 21:24:31.261199-07	35mm	factory_roll	\N	\N	\N	R008	\N
deafa787-f828-44a8-a7a7-f90087bc93d7	d43eded1-69f1-427d-a695-70dbe56b69ef	aee798ee-c90b-43dd-a85a-57b795d33dfd	3	\N	fridge	\N	\N	bulk-spooled cassettes	2026-04-11 16:26:52.67673-07	2026-05-01 21:04:18.999917-07	35mm	factory_roll	\N	\N	24	\N	\N
5a97b16a-c87f-406e-a7d9-a5deaa6f91b0	d43eded1-69f1-427d-a695-70dbe56b69ef	bce2b5c9-2d4c-467c-9352-de43c2ee7023	6	\N	fridge	\N	\N	\N	2026-04-11 16:11:22.465974-07	2026-05-01 21:22:13.162861-07	35mm	factory_roll	\N	\N	\N	\N	\N
d8d722f9-5088-4d42-8f0e-228e7ff950e3	d43eded1-69f1-427d-a695-70dbe56b69ef	5a05232c-37df-4618-821b-59fdbf24ec5d	1	~2010	fridge	\N	\N	Fuji discontinued this line ~2007, so this roll is likely ~15 years past expiration. Rate down a stop or two at load time.	2026-04-11 18:19:12.434702-07	2026-04-11 18:19:12.458-07	35mm	factory_roll	\N	\N	\N	R016	\N
263cdea4-e57b-4dc6-b450-0d412fb9e7a8	d43eded1-69f1-427d-a695-70dbe56b69ef	ed721b8a-4c96-4f89-b6e2-c7802e5d23ec	3	\N	fridge	\N	\N	\N	2026-04-11 18:23:17.232235-07	2026-04-11 18:23:17.232235-07	35mm	factory_roll	\N	\N	\N	\N	\N
4ba6099f-751d-4d1d-8a50-a132ab9bbd5f	d43eded1-69f1-427d-a695-70dbe56b69ef	778072dc-6bce-46d0-b43e-ef20da374970	2	\N	fridge	\N	\N	\N	2026-04-11 18:24:32.732498-07	2026-04-11 18:24:32.732498-07	35mm	factory_roll	\N	\N	\N	\N	\N
749c7004-f503-4640-82f1-0c1e0b85a237	d43eded1-69f1-427d-a695-70dbe56b69ef	822a752f-82eb-4cbd-94a2-bfb0a2130302	1	2022	fridge	\N	\N	\N	2026-04-11 18:25:18.384043-07	2026-04-11 18:25:18.384043-07	35mm	factory_roll	\N	\N	\N	\N	\N
3fd8862a-c91f-4248-bb3c-bfd7ac188a63	d43eded1-69f1-427d-a695-70dbe56b69ef	4f64213e-1317-4eb5-a518-d0fd7193823d	1	\N	fridge	\N	\N	\N	2026-04-11 18:28:24.09354-07	2026-04-11 18:28:24.09354-07	35mm	factory_roll	\N	\N	\N	\N	\N
243de2f7-bc78-45a9-906f-2fa0ca6409be	d43eded1-69f1-427d-a695-70dbe56b69ef	d3a6998f-d6c4-4470-8826-46737470c1b5	2	\N	fridge	\N	\N	24-exposure rolls, unknown expiration, unlikely to shoot.	2026-04-11 18:29:50.534462-07	2026-04-11 18:29:50.534462-07	35mm	factory_roll	\N	\N	24	\N	\N
1680379b-d5ee-4da0-ad05-2a233d1f4bfc	d43eded1-69f1-427d-a695-70dbe56b69ef	b430b223-a809-42f7-b2dd-0e5a36a03f16	1	\N	fridge	\N	\N	Slightly past expiration but not significantly.	2026-04-11 18:31:16.048495-07	2026-04-11 18:31:16.048495-07	35mm	factory_roll	\N	\N	\N	\N	\N
4b5d4d29-b397-410c-8119-5cfeb34f1efd	d43eded1-69f1-427d-a695-70dbe56b69ef	36ffb370-b34d-4635-beaa-3555cdd672e4	1	\N	fridge	\N	\N	Out of box, not really expired but should shoot soon.	2026-04-11 18:32:38.590546-07	2026-04-11 18:32:38.613-07	35mm	factory_roll	\N	\N	\N	R017	\N
441fbf90-3ae3-4e31-aedb-6004d0cb2190	d43eded1-69f1-427d-a695-70dbe56b69ef	a907a12e-7f02-4fb0-8923-2f245457bd8b	1	\N	fridge	\N	\N	Out of box, fresh enough, should shoot soon.	2026-04-11 18:34:18.360784-07	2026-04-11 18:34:18.384-07	35mm	factory_roll	\N	\N	\N	R018	\N
0b9ccd1e-3d08-415a-9357-f7098384bffb	d43eded1-69f1-427d-a695-70dbe56b69ef	3b046fe1-068b-4156-b205-38366dc9d679	1	\N	fridge	\N	\N	Rolled up in cassette, leader inside. Fresh. Fish leader before reloading.	2026-04-11 18:36:20.533477-07	2026-04-11 18:36:20.557-07	35mm	factory_roll	\N	\N	\N	R019	\N
6668d770-b621-4926-aec2-d17c9d70b9ce	d43eded1-69f1-427d-a695-70dbe56b69ef	7fc536bd-66aa-4bbc-960c-544d639c950f	1	\N	fridge	\N	\N	Out of box. Fresh.	2026-04-11 18:37:42.350577-07	2026-04-11 18:37:42.372-07	35mm	factory_roll	\N	\N	\N	R020	\N
f9b8e3a0-5587-4d12-b686-fd44930eb605	d43eded1-69f1-427d-a695-70dbe56b69ef	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	0	\N	fridge	\N	\N	\N	2026-04-12 18:59:29.899153-07	2026-04-12 19:11:15.207-07	4x5	sheet	\N	\N	\N	\N	\N
d8987080-8d9c-4a53-a4f9-14a6de2805d3	d43eded1-69f1-427d-a695-70dbe56b69ef	deea6e69-42a7-4d93-bd6b-00e7fc92045a	1	1987	fridge	\N	\N	~39 years past expiration. Expect significant shifts and base fog. Rate down heavily at load time.\n\nRescue option: B&W cross-process, Rodinal stand 1+100, 20°C, 60 min, no agitation. Rate 1-2 stops below box. Expect low contrast + heavy base fog but usually scannable B&W.	2026-04-11 18:26:22.066932-07	2026-04-11 18:26:22.089-07	35mm	factory_roll	\N	\N	\N	\N	\N
de4378ff-d0da-4147-a2d3-06c67077af3a	d43eded1-69f1-427d-a695-70dbe56b69ef	561d839e-3459-4939-a777-422a92a2e205	1	1993	fridge	\N	\N	~30+ years past expiration. Unlikely to shoot.\n\nRescue option: B&W cross-process, Rodinal stand 1+100, 20°C, 60 min, no agitation. Rate 1-2 stops below box. Expect low contrast + heavy base fog but usually scannable B&W.	2026-04-11 18:40:02.772314-07	2026-04-11 18:40:02.772314-07	35mm	factory_roll	\N	\N	\N	\N	\N
13e8c31e-80e4-411e-85cf-f9d4708edcf7	d43eded1-69f1-427d-a695-70dbe56b69ef	362b021e-fd19-48fd-b6cc-4f5ee1ee5ba7	1	\N	fridge	\N	\N	Expiration unknown but stock dates to late 1980s–early 1990s; likely ~30+ years past expiration.\n\nRescue option: B&W cross-process, Rodinal stand 1+100, 20°C, 60 min, no agitation. Rate 1-2 stops below box. Expect low contrast + heavy base fog but usually scannable B&W.	2026-04-11 18:54:51.492874-07	2026-04-11 18:54:51.492874-07	35mm	factory_roll	\N	\N	\N	\N	\N
3f2bf5d1-6618-4bb1-866a-005f1906b731	d43eded1-69f1-427d-a695-70dbe56b69ef	5173fa4f-5925-477b-92b5-644394f564f2	1	~2005	fridge	\N	\N	Early 2000s stock. Likely ~20 years past expiration.\n\nRescue option: B&W cross-process, Rodinal stand 1+100, 20°C, 60 min, no agitation. Rate 1-2 stops below box. Expect low contrast + heavy base fog but usually scannable B&W.	2026-04-11 18:56:39.887349-07	2026-04-11 18:57:22.112-07	35mm	factory_roll	\N	\N	24	\N	\N
17ba9cc4-0934-4471-a8ad-ae4f509ab18a	d43eded1-69f1-427d-a695-70dbe56b69ef	27184828-62f2-4d45-84bf-8547db19dc36	1	\N	fridge	\N	\N	Sticker over plain black canister reading "Black's Slide Duplicating Film". No other info. Age unknown (Black's shut down 2015 so box is pre-2015 at minimum). Almost certainly expired.\n\nRescue option: B&W cross-process, Rodinal stand 1+100, 20°C, 60 min, no agitation. Rate 1-2 stops below box. Expect low contrast + heavy base fog but usually scannable B&W.	2026-04-11 18:59:35.557951-07	2026-04-11 18:59:35.581-07	35mm	factory_roll	\N	\N	\N	R021	\N
4da95e9c-d842-442f-bb47-db73f1a64a85	d43eded1-69f1-427d-a695-70dbe56b69ef	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	1	\N	fridge	\N	\N	Older box — qty is placeholder for sheets currently in holders. Full count TBD.	2026-04-12 19:16:54.105748-07	2026-04-12 19:16:54.168-07	4x5	sheet	\N	\N	\N	\N	\N
a96ab32a-7bb8-4aa5-9c3d-41afdde030e3	d43eded1-69f1-427d-a695-70dbe56b69ef	aee798ee-c90b-43dd-a85a-57b795d33dfd	0	\N	fridge	\N	\N	Box — qty is placeholder for sheets currently in holders. Full count TBD.	2026-04-12 19:16:54.126492-07	2026-04-12 19:16:54.21-07	4x5	sheet	\N	\N	\N	\N	\N
4f845f1f-4ee1-453a-acaf-130c75249448	d43eded1-69f1-427d-a695-70dbe56b69ef	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	39	\N	fridge	\N	\N	Fresh box, separate batch from the 2 loose sheets.	2026-04-12 19:03:19.361087-07	2026-05-01 20:19:47.417292-07	4x5	sheet	\N	\N	\N	\N	\N
a9844b83-70a9-491a-ab35-dea0bad04536	d43eded1-69f1-427d-a695-70dbe56b69ef	aee798ee-c90b-43dd-a85a-57b795d33dfd	0	\N	fridge	\N	\N	\N	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07	120	factory_roll	\N	\N	\N	\N	\N
4541dcbd-a70d-468b-b9da-837972503e3e	d43eded1-69f1-427d-a695-70dbe56b69ef	aee798ee-c90b-43dd-a85a-57b795d33dfd	1	\N	fridge	\N	\N	split from 24-frame bulk pack; status uncertain (possibly unshot)	2026-05-01 21:04:18.999917-07	2026-05-01 21:04:18.999917-07	35mm	factory_roll	\N	\N	24	R022	\N
6772f7a2-e80e-471f-bcd4-8a7bb70e115b	d43eded1-69f1-427d-a695-70dbe56b69ef	dafa9ff9-bd57-4a11-b77e-09ffe83f3e78	1	\N	fridge	\N	\N	vintage cassette, ripped leader — unshot	2026-05-01 21:36:48.630034-07	2026-05-01 21:36:48.630034-07	35mm	factory_roll	\N	\N	\N	R023	\N
2a0495bb-d879-449b-8f5b-12ca3df57a11	d43eded1-69f1-427d-a695-70dbe56b69ef	77625610-a311-4e12-a30d-499f0b853130	1	\N	fridge	\N	\N	ripped leader — unshot	2026-05-01 21:40:32.574486-07	2026-05-01 21:40:32.574486-07	35mm	factory_roll	\N	\N	\N	R024	\N
\.


--
-- Data for Name: film_stocks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.film_stocks (id, user_id, manufacturer, name, iso, type, notes, is_active, created_at, updated_at, frame_count) FROM stdin;
a30739bc-efc7-479f-a250-1f093df8f73b	c0fe3ff9-a993-4021-95f0-3f782e4038e0	Kodak	Tri-X 400	400	bw	\N	t	2026-03-30 18:17:30.294557-07	2026-03-30 18:17:30.294557-07	\N
aee798ee-c90b-43dd-a85a-57b795d33dfd	d43eded1-69f1-427d-a695-70dbe56b69ef	Ilford	HP5 Plus	400	bw	\N	t	2026-03-30 19:22:58.71147-07	2026-03-30 19:22:58.71147-07	\N
a1a136a7-d66a-46cd-9433-ff106fe3f3b9	d43eded1-69f1-427d-a695-70dbe56b69ef	Ilford	FP4 Plus	125	bw	\N	t	2026-03-30 19:22:58.719781-07	2026-03-30 19:22:58.719781-07	\N
bce2b5c9-2d4c-467c-9352-de43c2ee7023	d43eded1-69f1-427d-a695-70dbe56b69ef	NoColorStudio	no.5	5	bw	29 exposures per roll (non-standard)	t	2026-04-11 16:11:22.434031-07	2026-04-11 16:13:54.384-07	29
bd77c711-8ca6-4b25-9a59-edf4513fb6f1	d43eded1-69f1-427d-a695-70dbe56b69ef	NoColorStudio	No.10	100	bw	wide-spectrum panchromatic	t	2026-04-11 16:16:19.682371-07	2026-04-11 16:16:19.682371-07	\N
ed42bb5c-f728-4dcc-8351-36578fbc7563	d43eded1-69f1-427d-a695-70dbe56b69ef	NoColorStudio	No.12 Baryta	6	bw	orthochromatic paperfilm	t	2026-04-11 16:18:33.623783-07	2026-04-11 16:18:33.623783-07	16
c6b4d18a-c0a3-4420-80e4-ab6e57b9739c	d43eded1-69f1-427d-a695-70dbe56b69ef	Ilford	Ortho Plus	80	bw	\N	t	2026-04-11 16:23:31.80141-07	2026-04-11 16:23:31.80141-07	\N
42f44ce0-b4a1-45f4-835d-7845d983bb2b	d43eded1-69f1-427d-a695-70dbe56b69ef	Ilford	Delta 3200	3200	bw	\N	t	2026-04-11 16:23:31.835721-07	2026-04-11 16:23:31.835721-07	\N
e388e75a-5ca1-447f-adb9-0358ab3e8671	d43eded1-69f1-427d-a695-70dbe56b69ef	Ilford	XP2 Super	400	bw	C41-process black and white	t	2026-04-11 16:23:31.865566-07	2026-04-11 16:23:31.865566-07	\N
dafa9ff9-bd57-4a11-b77e-09ffe83f3e78	d43eded1-69f1-427d-a695-70dbe56b69ef	Ilford	Pan F Plus	50	bw	\N	t	2026-04-11 16:23:31.900046-07	2026-04-11 16:23:31.900046-07	\N
03ee0cb0-6259-4872-b69a-94ab31532599	d43eded1-69f1-427d-a695-70dbe56b69ef	Kentmere	Pan 100	100	bw	\N	t	2026-04-11 16:41:43.113547-07	2026-04-11 16:41:43.113547-07	\N
f070c495-d3dc-4666-ba4e-d4855df9aba9	d43eded1-69f1-427d-a695-70dbe56b69ef	Lomography	Fantome	8	bw	\N	t	2026-04-11 16:43:14.750721-07	2026-04-11 16:43:14.750721-07	\N
612da9ef-5796-4fe0-aba2-0ff83ba928ab	d43eded1-69f1-427d-a695-70dbe56b69ef	ADOX	CHS 100 II	100	bw	\N	t	2026-04-11 17:19:57.902583-07	2026-04-11 17:19:57.902583-07	\N
778072dc-6bce-46d0-b43e-ef20da374970	d43eded1-69f1-427d-a695-70dbe56b69ef	SantaColor	100	100	color_negative	Rebranded Kodak Aerocolor aerial surveillance stock. C-41 compatible.	t	2026-04-11 18:24:32.7101-07	2026-04-11 18:24:32.7101-07	\N
4b8c6364-deb6-43d6-b735-cc96a8c6d214	d43eded1-69f1-427d-a695-70dbe56b69ef	Efke	IR 820	400	bw	Infrared film, sensitive to ~820nm. Box ISO 400 unfiltered. With IR filter (Hoya R72, Tiffen #87, B+W 092): rate ISO 25. With very deep IR filter: rate ISO 1-2. Standard B&W chemistry.	t	2026-04-11 17:21:31.641563-07	2026-04-11 17:24:25.229-07	\N
97899da6-11a2-470a-b629-723b51930301	d43eded1-69f1-427d-a695-70dbe56b69ef	Efke	KB 50	50	bw	\N	t	2026-04-11 17:25:57.181799-07	2026-04-11 17:25:57.181799-07	\N
3c467ec4-504b-4d0c-ac76-085fa11aa165	d43eded1-69f1-427d-a695-70dbe56b69ef	Japan Camera Hunter	StreetPan 400	400	bw	\N	t	2026-04-11 17:26:45.701825-07	2026-04-11 17:26:45.701825-07	\N
c9bb56da-6fe5-41a7-a87b-1dfde30cc5bd	d43eded1-69f1-427d-a695-70dbe56b69ef	Foma	Ortho 400	400	bw	orthochromatic	t	2026-04-11 17:27:44.728108-07	2026-04-11 17:27:44.728108-07	\N
fbfb3f3a-b396-4cbe-9717-b20ec744dd1b	d43eded1-69f1-427d-a695-70dbe56b69ef	Ferrania	P30	80	bw	\N	t	2026-04-11 17:28:36.071509-07	2026-04-11 17:28:36.071509-07	\N
79fad1b7-75b1-42c2-a934-4b6557f2d2c3	d43eded1-69f1-427d-a695-70dbe56b69ef	Ferrania	Orto	50	bw	orthochromatic	t	2026-04-11 17:29:19.2075-07	2026-04-11 17:29:19.2075-07	\N
3818009d-c3de-40f1-82c9-c9f6f9413ede	d43eded1-69f1-427d-a695-70dbe56b69ef	Kodak	Technical Pan	25	bw	Kodak 2415. Discontinued 2004. Fine-grain extended-red B&W. ISO 16-25 for pictorial (low contrast), up to 125-320 for high contrast. Kodaks Technidol developer is long gone; realistic options: highly-dilute Rodinal, HC-110 (dilute), D-76 (will be extreme contrast). Avoid D-19/Dektol unless high-contrast line work is the goal.	t	2026-04-11 17:30:53.295929-07	2026-04-11 17:31:28.953-07	\N
f228f76e-d873-4eb5-8bac-cbe79fa0d422	d43eded1-69f1-427d-a695-70dbe56b69ef	Kodak	T-Max 100	100	bw	\N	t	2026-04-11 17:32:44.405937-07	2026-04-11 17:32:44.405937-07	\N
2cf48166-e27e-4d99-8a81-e51279b4e98f	d43eded1-69f1-427d-a695-70dbe56b69ef	CatLABS	X Film 320 Pro	320	bw	\N	t	2026-04-11 17:33:42.538181-07	2026-04-11 17:33:42.538181-07	\N
068df7e1-8f30-4560-8f39-715b5106e643	d43eded1-69f1-427d-a695-70dbe56b69ef	Rollei	Retro 400S	400	bw	\N	t	2026-04-11 17:34:39.964231-07	2026-04-11 17:34:39.964231-07	\N
3841ac74-2774-4cf6-8724-226bc4b6c83e	d43eded1-69f1-427d-a695-70dbe56b69ef	Rollei	Infrared	400	bw	Near-IR sensitive (~750nm). Box range 200-400; rate lower (25 or below) with an IR filter.	t	2026-04-11 17:36:18.138059-07	2026-04-11 17:36:18.138059-07	\N
1cb6a6be-de3d-4f20-9424-e1446f3bb9b4	d43eded1-69f1-427d-a695-70dbe56b69ef	Rollei	Infrarot	400	bw	German-labeled IR film (Infrarot = Infrared). Likely same emulsion as Rollei Infrared but treating as separate stock.	t	2026-04-11 17:37:44.743701-07	2026-04-11 17:37:44.743701-07	\N
345b2a21-1905-4b17-9fb5-7f5d4ea95e7a	d43eded1-69f1-427d-a695-70dbe56b69ef	Silberra	S25 Limited Edition	25	bw	\N	t	2026-04-11 17:38:48.681714-07	2026-04-11 17:38:48.681714-07	\N
ea1992e5-c396-45d0-a4a3-7e77cb30cd93	d43eded1-69f1-427d-a695-70dbe56b69ef	ADOX	CMS 20	20	bw	Ultra-fine grain, high-resolution. New version requires ADOX CMS II developer for optimal results.	t	2026-04-11 17:40:08.242196-07	2026-04-11 17:40:08.242196-07	\N
564b6bef-e10a-49f9-9013-aaf60040ed9f	d43eded1-69f1-427d-a695-70dbe56b69ef	Rollei	ATP 1.1	32	bw	Advanced Technical Pan — ultra-fine grain microfilm. Use ATP-DC developer for pictorial results; standard devs give extreme contrast.	t	2026-04-11 17:41:46.202977-07	2026-04-11 17:41:46.202977-07	\N
37b8cad4-d2ab-4ae2-a1cc-b8f36d2a99b1	d43eded1-69f1-427d-a695-70dbe56b69ef	Kodak	Tri-X Pan 400	400	bw	Old Tri-X Pan branding (pre-400TX rename).	t	2026-04-11 17:50:10.515553-07	2026-04-11 17:50:10.515553-07	\N
9ab33c20-cbbe-4613-9904-d61ee9d1718a	d43eded1-69f1-427d-a695-70dbe56b69ef	Kodak	Double-X 5222	250	bw	Eastman Double-X motion picture stock. Native EI 250 daylight / 200 tungsten. Shoots from 6 to 6400 with dev adjustments. Develops in any B&W dev.	t	2026-04-11 17:51:49.657807-07	2026-04-11 17:51:49.657807-07	\N
8fa17252-6af5-4a06-a68a-3d5e88643e05	d43eded1-69f1-427d-a695-70dbe56b69ef	Ilford	Delta 400	400	bw	\N	t	2026-04-11 17:54:55.173954-07	2026-04-11 17:54:55.173954-07	\N
ac6d943d-46ba-404f-bbc0-54f0a5f12cdc	d43eded1-69f1-427d-a695-70dbe56b69ef	Ferrania	P33	160	bw	Panchromatic, 160 ISO. Made in Cairo Montenotte, Italy. Successor to P30 — more versatile, classic look, fine grain, good contrast.	t	2026-04-11 17:56:31.570034-07	2026-04-11 17:56:31.570034-07	\N
81fff50e-94b7-4cc7-9c23-a1c2937bc82a	d43eded1-69f1-427d-a695-70dbe56b69ef	Kentmere	Pan 200	200	bw	\N	t	2026-04-11 17:59:14.965471-07	2026-04-11 17:59:14.965471-07	\N
ea8830a4-12ed-4201-9991-446a25d173ee	d43eded1-69f1-427d-a695-70dbe56b69ef	Unknown	Hand-labeled 400	400	bw	Previous owner hand-wrote ISO 400 on the cassette. Manufacturer and exact stock unknown.	t	2026-04-11 18:03:30.693705-07	2026-04-11 18:03:30.693705-07	\N
b28883e1-0938-4b04-b060-545bc4d21f66	d43eded1-69f1-427d-a695-70dbe56b69ef	Ilford	Delta 100	100	bw	\N	t	2026-04-11 18:04:28.169117-07	2026-04-11 18:04:28.169117-07	\N
d41801c0-113a-487e-bcef-35af2d89d079	d43eded1-69f1-427d-a695-70dbe56b69ef	Unknown	Bulk mystery	400	bw	Generic placeholder for bulk-spooled film of uncertain identity. Plan on stand development.	t	2026-04-11 18:07:56.640159-07	2026-04-11 18:07:56.640159-07	\N
01feb6be-5390-433a-88ce-6d57a97e73f9	d43eded1-69f1-427d-a695-70dbe56b69ef	Unknown	Black canister mystery	400	bw	Fully opaque black canisters, no markings. Assume very old. Plan: rate at ISO 25 or lower, stand-dev in Rodinal.	t	2026-04-11 18:10:07.479665-07	2026-04-11 18:10:07.479665-07	\N
5a05232c-37df-4618-821b-59fdbf24ec5d	d43eded1-69f1-427d-a695-70dbe56b69ef	Fujifilm	Neopan SS	100	bw	Classic Fuji ortho-panchromatic B&W, wide latitude. Discontinued ~2007 (latest 2012). Shelf life would put expiration around 2009-2014.	t	2026-04-11 18:19:12.412575-07	2026-04-11 18:19:12.412575-07	\N
ed721b8a-4c96-4f89-b6e2-c7802e5d23ec	d43eded1-69f1-427d-a695-70dbe56b69ef	Atlanta Film Co	Koji 125T	125	color_negative	Tungsten-balanced color negative (3200K). Likely rebranded motion picture stock.	t	2026-04-11 18:23:17.196896-07	2026-04-11 18:23:17.196896-07	\N
822a752f-82eb-4cbd-94a2-bfb0a2130302	d43eded1-69f1-427d-a695-70dbe56b69ef	Kodak	Ektachrome E100	100	color_positive	Color reversal (slide). E-6 process.	t	2026-04-11 18:25:18.35761-07	2026-04-11 18:25:18.35761-07	\N
deea6e69-42a7-4d93-bd6b-00e7fc92045a	d43eded1-69f1-427d-a695-70dbe56b69ef	Kodak	Kodacolor VR 400	400	color_negative	Vintage 1980s Kodak C-41 color negative. Discontinued long ago.	t	2026-04-11 18:26:22.046497-07	2026-04-11 18:26:22.046497-07	\N
4f64213e-1317-4eb5-a518-d0fd7193823d	d43eded1-69f1-427d-a695-70dbe56b69ef	Harman	Switch Azure 125	125	color_negative	Creative C-41 color negative with color-swapped couplers: blues → orange/amber, yellows → azure blue, reds → purple. High contrast, narrow dynamic range (~5-6 stops). Standard C-41 processing.	t	2026-04-11 18:28:24.066381-07	2026-04-11 18:28:24.066381-07	\N
d3a6998f-d6c4-4470-8826-46737470c1b5	d43eded1-69f1-427d-a695-70dbe56b69ef	Kodak	Gold 100	100	color_negative	C-41 consumer color negative.	t	2026-04-11 18:29:50.507286-07	2026-04-11 18:29:50.507286-07	\N
b430b223-a809-42f7-b2dd-0e5a36a03f16	d43eded1-69f1-427d-a695-70dbe56b69ef	Moody's	400T	400	color_negative	Tungsten-balanced (3200K) respooled motion picture stock. ECN-2 process (needs rem-jet removal or specialized lab, not standard C-41).	t	2026-04-11 18:31:16.012751-07	2026-04-11 18:31:16.012751-07	\N
36ffb370-b34d-4635-beaa-3555cdd672e4	d43eded1-69f1-427d-a695-70dbe56b69ef	Kodak	Portra 400	400	color_negative	Pro C-41 color negative, wide latitude.	t	2026-04-11 18:32:38.560172-07	2026-04-11 18:32:38.560172-07	\N
a907a12e-7f02-4fb0-8923-2f245457bd8b	d43eded1-69f1-427d-a695-70dbe56b69ef	Harman	Phoenix 200	200	color_negative	Harmans first in-house C-41 color negative. High contrast, narrow latitude.	t	2026-04-11 18:34:18.337532-07	2026-04-11 18:34:18.337532-07	\N
3b046fe1-068b-4156-b205-38366dc9d679	d43eded1-69f1-427d-a695-70dbe56b69ef	Kodak	Ektar 100	100	color_negative	Pro C-41 color negative. Fine grain, saturated, daylight-balanced.	t	2026-04-11 18:36:20.505463-07	2026-04-11 18:36:20.505463-07	\N
7fc536bd-66aa-4bbc-960c-544d639c950f	d43eded1-69f1-427d-a695-70dbe56b69ef	Lomography	Purple	400	color_negative	Creative C-41 color-shift film (greens → purple). Variable ISO 100-400 depending on desired effect.	t	2026-04-11 18:37:42.323439-07	2026-04-11 18:37:42.323439-07	\N
561d839e-3459-4939-a777-422a92a2e205	d43eded1-69f1-427d-a695-70dbe56b69ef	Agfa	Agfachrome 1000 RS	1000	color_positive	E-6 color reversal. Released 1989, discontinued 1995. Known for grain and blue shifts.	t	2026-04-11 18:40:02.761158-07	2026-04-11 18:40:02.761158-07	\N
362b021e-fd19-48fd-b6cc-4f5ee1ee5ba7	d43eded1-69f1-427d-a695-70dbe56b69ef	Fujifilm	Fujicolor Super HR 100	100	color_negative	Official film of Expo 1988. Japan-made C-41. Long discontinued.	t	2026-04-11 18:54:51.448375-07	2026-04-11 18:54:51.448375-07	\N
5173fa4f-5925-477b-92b5-644394f564f2	d43eded1-69f1-427d-a695-70dbe56b69ef	Fujifilm	Fujicolor Super HQ 200	200	color_negative	Fuji consumer C-41, early 2000s production (US Wal-Mart channel). SureColor tech. Example expirations in the wild date to 2005. Discontinued.	t	2026-04-11 18:56:39.864821-07	2026-04-11 18:57:22.079-07	\N
27184828-62f2-4d45-84bf-8547db19dc36	d43eded1-69f1-427d-a695-70dbe56b69ef	Black's	Slide Duplicating Film	8	color_positive	Almost certainly a Black's Photography (Canadian retailer, 1930-2015) rebadge of Kodak Ektachrome SE Slide Duplicating Film SO-366 or similar. E-6 reversal, tungsten-balanced (~3200K), low-contrast, fine grain. ISO is batch-variable and was printed on the original carton (which is lost) — typical range 8-12. Placeholder ISO 8.	t	2026-04-11 18:59:35.531801-07	2026-04-11 18:59:35.531801-07	\N
02c35ea6-8d7d-42a6-bb27-84c80678f4b5	d43eded1-69f1-427d-a695-70dbe56b69ef	Arista	EDU Ultra 100	100	bw	Budget B&W, widely believed to be rebranded Fomapan 100.	t	2026-04-12 18:59:29.87453-07	2026-04-12 18:59:29.87453-07	\N
badc259c-4762-45b3-9017-cfeabffdd00d	d43eded1-69f1-427d-a695-70dbe56b69ef	Arista	EDU 400 DX	400	bw	\N	t	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07	36
3b66f352-2912-4921-a189-300b8a6bc8cc	d43eded1-69f1-427d-a695-70dbe56b69ef	Fujifilm	Acros II 100	100	bw	\N	t	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07	36
77625610-a311-4e12-a30d-499f0b853130	d43eded1-69f1-427d-a695-70dbe56b69ef	Shanghai	GP3 100	100	bw	\N	t	2026-05-01 21:40:32.574486-07	2026-05-01 21:40:32.574486-07	36
81cf5142-c23e-4f7e-b7ff-3754e0f344ed	d43eded1-69f1-427d-a695-70dbe56b69ef	Kodak	T-Max 400	400	bw	\N	t	2026-05-01 21:47:52.704463-07	2026-05-01 21:47:52.704463-07	36
\.


--
-- Data for Name: frames; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.frames (id, roll_id, frame_number, lens_id, shutter_speed, aperture, compensation, metering_mode, subject, notes, latitude, longitude, location_name, shot_at, tags, rating, is_portfolio, created_at, updated_at) FROM stdin;
02a42fd8-2f36-4f17-8069-aa7139582656	167302f3-f2ff-4a66-b015-ae2c4f39a0d7	1	\N	\N	\N	\N	\N	Tacoma Narrows Bridge	150mm lens	\N	\N	\N	2026-04-12 19:11:15.165-07	{}	\N	f	2026-04-12 19:11:15.165313-07	2026-04-12 19:11:15.165313-07
96d6f8fe-0c8b-49ac-abef-498fb3a71761	f3c1eee9-8a7a-485f-9413-c7c170c7b278	1	\N	\N	\N	\N	\N	Tacoma Narrows Bridge	150mm lens	\N	\N	\N	2026-04-12 19:11:15.226-07	{}	\N	f	2026-04-12 19:11:15.227114-07	2026-04-12 19:11:15.227114-07
9a5f7611-3982-4d8e-9448-a0f2c1456aa2	9a48fe91-34a3-4d71-bf3b-638aad97f3dd	1	\N	\N	\N	\N	\N	Fort Worden	150mm lens	\N	\N	\N	2026-05-01 20:19:47.417292-07	{}	\N	f	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07
2837cc8a-02ab-4dc7-af5e-b3bcccd8cff4	a69124fc-0b51-46c8-a9e5-a3f12dcd42cf	1	\N	\N	\N	\N	\N	Fort Worden	150mm lens	\N	\N	\N	2026-05-01 20:19:47.417292-07	{}	\N	f	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07
db6c78cf-c6ae-478d-a521-8a8abc0b1703	f0f11095-d728-4b74-b051-f31cd5aecd20	1	\N	\N	\N	\N	\N	Fort Worden	150mm lens	\N	\N	\N	2026-05-01 20:19:47.417292-07	{}	\N	f	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07
a8a2d3e9-6c02-4e3d-becc-b5ff4180224f	d228c9da-af9e-4260-9046-1e850955d026	1	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
27909ecc-8f84-4060-b679-054d1fb81a76	d228c9da-af9e-4260-9046-1e850955d026	2	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
ebf80dee-8009-4adb-8a5c-f0b002c5545e	d228c9da-af9e-4260-9046-1e850955d026	3	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
bfece404-eb34-423b-8a3c-9d153718f385	d228c9da-af9e-4260-9046-1e850955d026	4	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
e492549d-8d7c-4ab5-82c9-b510bf1f82c3	d228c9da-af9e-4260-9046-1e850955d026	5	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
7ddf6ff5-030d-43d2-8aa7-6bf790833620	d228c9da-af9e-4260-9046-1e850955d026	6	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
7f185021-0ab6-4e9f-902d-0b01a1f69069	d228c9da-af9e-4260-9046-1e850955d026	7	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
a6381f06-4c7a-4a51-ba5b-6aa21c219bb0	d228c9da-af9e-4260-9046-1e850955d026	8	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
010ca161-dcbb-4391-bece-36b726b50a3f	d228c9da-af9e-4260-9046-1e850955d026	9	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
67dcf28b-b186-478a-819b-aca42efc1c63	d228c9da-af9e-4260-9046-1e850955d026	10	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
b78bec89-573a-4e6a-81d5-1eba04260f0a	d228c9da-af9e-4260-9046-1e850955d026	11	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
ca3fd91e-373b-4a44-9807-a354dcf58259	d228c9da-af9e-4260-9046-1e850955d026	12	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
3bc44d07-200f-4c0d-8be0-b8fbc7e61b28	d228c9da-af9e-4260-9046-1e850955d026	13	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
94045fb8-91cd-4a5f-99e5-6e84cffa3cd8	d228c9da-af9e-4260-9046-1e850955d026	14	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
3266ba73-33a7-49ed-be5f-3613d6e83f69	d228c9da-af9e-4260-9046-1e850955d026	15	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
57d3a5e5-ac7b-4ede-b881-1f8894aa5286	d228c9da-af9e-4260-9046-1e850955d026	16	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
8c50603e-8116-42c1-9217-8c1ee40fe513	d228c9da-af9e-4260-9046-1e850955d026	17	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
542b0200-7f55-46a2-9506-0b1a50c8984c	d228c9da-af9e-4260-9046-1e850955d026	18	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
e0c5a5e6-7c64-4d63-9795-fa0dd85ca183	d228c9da-af9e-4260-9046-1e850955d026	19	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
290d7191-bc25-410d-b8c0-4d7281a03566	d228c9da-af9e-4260-9046-1e850955d026	20	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	Fort Worden	\N	\N	\N	\N	2026-05-01 20:31:06.312896-07	{}	\N	f	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07
4c2f2050-b8fb-4157-8703-6c434023c9cf	da250e1e-fb73-4263-b6d2-25ed81106fb0	1	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
fac45417-e364-4f14-9308-be7ce4430da3	da250e1e-fb73-4263-b6d2-25ed81106fb0	2	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
9f8a0e9c-92cd-4735-b34a-79d598381391	da250e1e-fb73-4263-b6d2-25ed81106fb0	3	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
76f17ded-4392-494a-9bb1-c25af31d3bd0	da250e1e-fb73-4263-b6d2-25ed81106fb0	4	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
2b342c92-21c8-49e6-bf6d-b8239a6154c3	da250e1e-fb73-4263-b6d2-25ed81106fb0	5	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
0d6f4fe0-8900-4b36-a701-c7bff508d836	da250e1e-fb73-4263-b6d2-25ed81106fb0	6	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
e458082a-1d30-40f5-94cd-4bb89f3d97d0	da250e1e-fb73-4263-b6d2-25ed81106fb0	7	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
9adb9a59-7c5b-447a-a866-26731475745e	da250e1e-fb73-4263-b6d2-25ed81106fb0	8	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
17e22cb5-b036-4a6c-ab37-178168bd41c4	da250e1e-fb73-4263-b6d2-25ed81106fb0	9	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
942cb1c3-510d-4f63-a566-b0c8379daffa	da250e1e-fb73-4263-b6d2-25ed81106fb0	10	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
0d5a5a38-626b-4405-a55d-0a7cc23eac8c	da250e1e-fb73-4263-b6d2-25ed81106fb0	11	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
6cd19d13-c943-40c9-ba21-5ff66e945912	da250e1e-fb73-4263-b6d2-25ed81106fb0	12	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
f046e23c-0674-453f-8edb-ad01782a8fc8	da250e1e-fb73-4263-b6d2-25ed81106fb0	13	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
b5f80c31-3f4b-4b93-837f-2ed5e65de2cf	da250e1e-fb73-4263-b6d2-25ed81106fb0	14	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
79340778-a78a-43b2-aae8-44459ae82cba	da250e1e-fb73-4263-b6d2-25ed81106fb0	15	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
f6160f5e-8a80-4d60-bc5a-03a902451528	da250e1e-fb73-4263-b6d2-25ed81106fb0	16	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
563bb686-bd2d-437c-b722-944783d1df19	da250e1e-fb73-4263-b6d2-25ed81106fb0	17	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
825dcf13-7643-4af8-a821-138f568ab55d	da250e1e-fb73-4263-b6d2-25ed81106fb0	18	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
c5092bc7-3181-45c3-8f53-fb015943a335	da250e1e-fb73-4263-b6d2-25ed81106fb0	19	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
6bd75e99-be63-46f5-ba70-8b06c0a5081a	da250e1e-fb73-4263-b6d2-25ed81106fb0	20	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
d35984e8-a9df-4f3d-957e-01073d2b467c	da250e1e-fb73-4263-b6d2-25ed81106fb0	21	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
3f3d21be-a1c0-4bad-a3ae-b339536fa406	da250e1e-fb73-4263-b6d2-25ed81106fb0	22	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
ca77ab3f-0155-4e0c-9621-2d6bcb0339c7	da250e1e-fb73-4263-b6d2-25ed81106fb0	23	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
7a148994-81ca-4104-86d2-95ac0a00cad3	da250e1e-fb73-4263-b6d2-25ed81106fb0	24	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
803940f0-9221-4d39-8ce1-964f4f040268	da250e1e-fb73-4263-b6d2-25ed81106fb0	25	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
52fd9064-4384-4b46-83eb-cd592116eab1	da250e1e-fb73-4263-b6d2-25ed81106fb0	26	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
05ca1fe3-e521-4af6-bf7f-0ee3c1541708	da250e1e-fb73-4263-b6d2-25ed81106fb0	27	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
ec52f4d7-f0bb-4a54-bfd3-1b1932a22ddb	da250e1e-fb73-4263-b6d2-25ed81106fb0	28	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
96921950-da8d-431e-9e9e-e79a2f3f2382	da250e1e-fb73-4263-b6d2-25ed81106fb0	29	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
af9881ab-dd5e-4ba7-96e3-3747367ff0ae	da250e1e-fb73-4263-b6d2-25ed81106fb0	30	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
4a4d2e02-6e4f-47b4-9459-63c1fcb98a9a	da250e1e-fb73-4263-b6d2-25ed81106fb0	31	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
440b02c4-41c1-4dc4-b8a6-67988cc3d392	da250e1e-fb73-4263-b6d2-25ed81106fb0	32	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
ee9d86ba-95bf-4095-a023-88e1090cdfbe	da250e1e-fb73-4263-b6d2-25ed81106fb0	33	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
a52b2663-6200-4b42-b520-e4216071676f	da250e1e-fb73-4263-b6d2-25ed81106fb0	34	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
f112e706-4e82-4972-a323-4c086ec93b0f	da250e1e-fb73-4263-b6d2-25ed81106fb0	35	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
e84c3445-09f3-4f51-914c-0b1c81f03962	da250e1e-fb73-4263-b6d2-25ed81106fb0	36	\N	\N	\N	\N	\N	drivers seat	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:40:37.523105-07	2026-05-01 20:40:37.523105-07
c2882d5b-dccd-4a98-9d73-8256a1c84570	7099e680-3cdf-4da0-b790-f6630c94b851	1	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
ebb07e0c-b6cf-44fb-ad72-f18ea21490b6	7099e680-3cdf-4da0-b790-f6630c94b851	2	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
e7eda7e6-e2c3-4b97-9769-9452b0ae8b6c	7099e680-3cdf-4da0-b790-f6630c94b851	3	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
0a503428-98d2-4c43-805a-0bfaa913f59c	7099e680-3cdf-4da0-b790-f6630c94b851	4	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
6c0b4e90-ecda-47cc-8eb7-c9c27b3a74c8	7099e680-3cdf-4da0-b790-f6630c94b851	5	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
6e0865d4-9160-47be-9ec9-5006bb1c04f8	7099e680-3cdf-4da0-b790-f6630c94b851	6	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
f0988b68-ad2f-44b4-9ffd-d5f1f7adc2d9	7099e680-3cdf-4da0-b790-f6630c94b851	7	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
07986f26-5131-4404-9786-f4fa753dbdc7	7099e680-3cdf-4da0-b790-f6630c94b851	8	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
77eaa6a7-0814-46aa-bd03-17be70c7c0ca	7099e680-3cdf-4da0-b790-f6630c94b851	9	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
39cdea3c-a024-4ff2-ab64-24542a10d35a	7099e680-3cdf-4da0-b790-f6630c94b851	10	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
fa31e90d-827e-4091-bfe8-668cb1e97dfa	7099e680-3cdf-4da0-b790-f6630c94b851	11	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
7bd54802-4588-4fd5-8861-5eb68d14054d	7099e680-3cdf-4da0-b790-f6630c94b851	12	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
829765cb-0f64-4020-9728-a372a324434a	7099e680-3cdf-4da0-b790-f6630c94b851	13	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
585caaf3-591a-4e69-8419-92c9938bdba4	7099e680-3cdf-4da0-b790-f6630c94b851	14	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
11c8ace8-5e2c-4f9f-9d5a-0342152282e4	7099e680-3cdf-4da0-b790-f6630c94b851	15	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
2c725fe2-2188-4cb9-ad87-7b48b5270851	7099e680-3cdf-4da0-b790-f6630c94b851	16	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
f01324e2-09ec-4bf6-8600-cfc8af71ab6d	7099e680-3cdf-4da0-b790-f6630c94b851	17	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
0d2c06dc-257d-4b76-bebf-23caed58d87b	7099e680-3cdf-4da0-b790-f6630c94b851	18	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
f3f74ee2-054c-40a0-b6df-32a685396c0e	7099e680-3cdf-4da0-b790-f6630c94b851	19	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
de05fa91-a7f2-4ab7-9438-46b18b0ff892	7099e680-3cdf-4da0-b790-f6630c94b851	20	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
b51154ed-dfda-4d4d-8551-999299dc012a	7099e680-3cdf-4da0-b790-f6630c94b851	21	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
304e8c47-191d-4e40-9f79-1bcef70ba67b	7099e680-3cdf-4da0-b790-f6630c94b851	22	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
3658b20a-acc5-423a-876f-0729237c95d7	7099e680-3cdf-4da0-b790-f6630c94b851	23	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
cb348170-ade5-407f-980f-a9317c871f2d	7099e680-3cdf-4da0-b790-f6630c94b851	24	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
b6d0527b-3041-4042-b60d-4a7fe0c194f2	7099e680-3cdf-4da0-b790-f6630c94b851	25	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
a302755d-f54e-4018-9e9f-b40983800a13	7099e680-3cdf-4da0-b790-f6630c94b851	26	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
5efcbf78-1fe2-46b8-9986-edf1bc0a3ec9	7099e680-3cdf-4da0-b790-f6630c94b851	27	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
557d2aed-56f6-4da8-9664-03cfcc027a00	7099e680-3cdf-4da0-b790-f6630c94b851	28	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
bcc9d174-7424-4bd9-92e7-f7589587151f	7099e680-3cdf-4da0-b790-f6630c94b851	29	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07
7c042fad-b00c-4e75-a67d-0bd0026450b6	f49bef4e-800f-44f8-87c4-bb0873e71a30	1	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
305f0319-7fe9-4e55-bdbc-58a125914e6a	f49bef4e-800f-44f8-87c4-bb0873e71a30	2	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
0313eba6-ea49-48e9-8ecf-4680dd87a7b8	f49bef4e-800f-44f8-87c4-bb0873e71a30	3	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
835d37a7-fc51-441b-96a6-e46725a4766f	f49bef4e-800f-44f8-87c4-bb0873e71a30	4	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
cc149b7a-0ffc-4171-b001-011b7497764e	f49bef4e-800f-44f8-87c4-bb0873e71a30	5	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
685ba8af-53aa-4063-a7bc-e409c43294de	f49bef4e-800f-44f8-87c4-bb0873e71a30	6	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
9cb29f48-588a-4233-ad5b-20979fd6d392	f49bef4e-800f-44f8-87c4-bb0873e71a30	7	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
648b0384-d29b-4401-9d56-90f42eb1f054	f49bef4e-800f-44f8-87c4-bb0873e71a30	8	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
caa2490c-06e1-4cfd-92e8-587fbf0acf5b	f49bef4e-800f-44f8-87c4-bb0873e71a30	9	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
09302565-9064-4b8a-a619-d66bf577da47	f49bef4e-800f-44f8-87c4-bb0873e71a30	10	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
38b883a4-c45c-417a-bf32-8e3e35123835	f49bef4e-800f-44f8-87c4-bb0873e71a30	11	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
640027bf-3632-40de-9c66-3517520d30c4	f49bef4e-800f-44f8-87c4-bb0873e71a30	12	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
3026e3c1-c0a4-44b2-a1ab-b8ced5a0d3af	f49bef4e-800f-44f8-87c4-bb0873e71a30	13	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
c4b63a70-ffcd-4de2-aa97-9262b2c60ea3	f49bef4e-800f-44f8-87c4-bb0873e71a30	14	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
bbb7f772-1620-4586-b148-c14bbedf3156	f49bef4e-800f-44f8-87c4-bb0873e71a30	15	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
4207e26d-e923-44b4-b69d-e6800dbd2d66	f49bef4e-800f-44f8-87c4-bb0873e71a30	16	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
5577b20a-6575-4a9f-81b5-9c6d3244cddf	f49bef4e-800f-44f8-87c4-bb0873e71a30	17	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
3244c0a5-b624-43fd-be05-ca5e9dc64de9	f49bef4e-800f-44f8-87c4-bb0873e71a30	18	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
9c7cf601-a6a4-4bd3-916e-19f8db835f7f	f49bef4e-800f-44f8-87c4-bb0873e71a30	19	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
be73b6c4-9102-449b-8f70-0ca0a63a9950	f49bef4e-800f-44f8-87c4-bb0873e71a30	20	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
cc9c60f7-b245-40f9-9aa3-e83fda0885de	f49bef4e-800f-44f8-87c4-bb0873e71a30	21	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
8d03f3de-c5d2-4d59-add8-20d6c261a105	f49bef4e-800f-44f8-87c4-bb0873e71a30	22	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
718fa08a-5ea2-4f53-8250-e425d6314dac	f49bef4e-800f-44f8-87c4-bb0873e71a30	23	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
4041d68f-3a9b-40d4-9e84-4be305f621aa	f49bef4e-800f-44f8-87c4-bb0873e71a30	24	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
dd276bd7-5336-4eb8-a743-c67571d79e28	f49bef4e-800f-44f8-87c4-bb0873e71a30	25	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
66e9d7ec-e150-4e99-8565-6af17929d484	f49bef4e-800f-44f8-87c4-bb0873e71a30	26	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
38915df8-698f-452b-806c-036adf56d73b	f49bef4e-800f-44f8-87c4-bb0873e71a30	27	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
09f174da-dc51-453a-a7af-aa035e9438bf	f49bef4e-800f-44f8-87c4-bb0873e71a30	28	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
d99edae6-fd9b-461d-ad13-0a1edb08a567	f49bef4e-800f-44f8-87c4-bb0873e71a30	29	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
d127e992-c9fe-4149-93c1-3fba9a0c1872	f49bef4e-800f-44f8-87c4-bb0873e71a30	30	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
bdc3d314-757f-4f16-992b-3bcd7380b274	f49bef4e-800f-44f8-87c4-bb0873e71a30	31	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
05ffa08f-26c3-4da5-84fd-8d218fd3e53e	f49bef4e-800f-44f8-87c4-bb0873e71a30	32	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
f7574635-d099-4f9a-b071-0567c3b1b040	f49bef4e-800f-44f8-87c4-bb0873e71a30	33	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
87cd021c-a030-4731-a88d-d3b2ee8f7904	f49bef4e-800f-44f8-87c4-bb0873e71a30	34	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
515f8938-d7cc-4a12-b615-261b795df5fe	f49bef4e-800f-44f8-87c4-bb0873e71a30	35	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
e941d6a2-4446-467a-b00a-59a2627af13e	f49bef4e-800f-44f8-87c4-bb0873e71a30	36	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
ae005d80-28b6-48bf-87da-3e32e955300e	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	1	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
9348deb5-3f12-4238-b7e6-9056f94c6987	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	2	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
93a62ceb-2711-4328-8766-a0ba8fcf4df3	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	3	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
f9c80a3b-7541-48f2-be51-6222017b3b2e	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	4	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
07457629-6c7d-4743-a0ba-b4a768e0cea7	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	5	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
01994cbb-41fc-4f32-8cf3-e559fe9cc2e3	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	6	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
ea4a0d1f-f4e1-4b4a-ab4f-385512ec34c0	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	7	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
518acc55-5596-405c-9e73-f46f8f9ed015	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	8	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
f0c569a0-194f-436d-9504-62b38333b2cc	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	9	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
d979ab39-f0fe-4893-ab47-c4ad587917e6	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	10	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
c44ff8f4-b7e8-41e5-afac-f94aa235229c	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	11	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
8306f6ca-8eb9-4d73-9bea-0b2562ba40af	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	12	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
53755fe7-6b49-4191-9443-cc82533af36c	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	13	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
f3f8d27f-e4f2-445c-8c5f-2ac5453e6988	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	14	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
ce915b31-62cf-4fe6-9e2e-1402c4a5e0d2	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	15	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
1e18358f-f784-46c1-a0c3-44fc56cefbdf	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	16	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
a9c66beb-dcbe-4ba1-9383-9b73a0b1117b	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	17	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
f9612c68-7bd7-431d-b21b-fc9b31bddb78	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	18	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
748f617b-3a7f-4972-8abb-d16877d4e15b	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	19	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
186d5e48-e54b-4825-b269-8c964f7aa1f2	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	20	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
0281f902-d14f-4c4d-aec4-ccea2748ab03	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	21	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
a055aa74-a648-42b8-a0f1-ac9191f0f4c6	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	22	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
a1febbbf-8dfd-41d9-8dda-b3d1459280e8	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	23	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
25905295-7edf-49b0-b3dc-666572643fff	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	24	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
331c91c4-e97c-4a03-9c4a-62d5485cf0ad	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	25	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
1a91c5ac-2ab8-4f48-9e6f-dab32b689ae7	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	26	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
c749f843-2928-4d34-8fdd-224291254884	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	27	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
aa6a868b-1ef0-4df5-8b7b-84a54dbbb106	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	28	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
152803b5-e2ef-4b25-b680-acbd67b62a91	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	29	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
91ded8eb-6e19-4280-a591-50147f3f8b99	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	30	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
a36f1486-c50a-4c5c-ba9b-ce7c27c94633	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	31	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
22f41465-bef3-4f13-bc1e-e34b249502bb	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	32	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
c7f77cff-c676-408e-bf0f-2445a26fcf3a	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	33	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
6ce68a84-ebc0-4101-b9ff-43d231678b15	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	34	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
addb9186-1237-4ff5-a79c-9fa1ab843b91	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	35	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
bf000703-7182-4c71-a1f4-79cf03b701bf	399a2c05-8c32-477c-8b7c-64b2eb6e27bf	36	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
df908db6-0aeb-487d-898c-262dfeea562f	5341c4e9-6e96-4f54-820e-f140c2f2b343	1	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
1bad3911-03eb-42f8-af66-8e2829a9706f	5341c4e9-6e96-4f54-820e-f140c2f2b343	2	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
d8f99372-9911-4029-8b8c-0a723583cc44	5341c4e9-6e96-4f54-820e-f140c2f2b343	3	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
eb130b7f-b270-40a1-a6c4-d4fe59c1fa3f	5341c4e9-6e96-4f54-820e-f140c2f2b343	4	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
93740e49-d1a5-4d17-b672-85b8f2ba046e	5341c4e9-6e96-4f54-820e-f140c2f2b343	5	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
06e6eef8-b07b-4836-b90b-a65f9af74eeb	5341c4e9-6e96-4f54-820e-f140c2f2b343	6	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
e1b57df3-7e1f-41d1-9493-d1e04e9ed638	5341c4e9-6e96-4f54-820e-f140c2f2b343	7	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
d4bae5c0-8849-4898-a281-5b5288a045cf	5341c4e9-6e96-4f54-820e-f140c2f2b343	8	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
a8432c64-bbd5-412c-943e-128e63833654	5341c4e9-6e96-4f54-820e-f140c2f2b343	9	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
1ca0759a-a622-43a8-bafc-d56867e18dbf	5341c4e9-6e96-4f54-820e-f140c2f2b343	10	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
a5174acf-5d65-49b8-ab88-ebe466130169	5341c4e9-6e96-4f54-820e-f140c2f2b343	11	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
b597cc0e-8960-4be0-98cb-453bcdae278b	5341c4e9-6e96-4f54-820e-f140c2f2b343	12	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
2668900c-7804-4223-88c5-1d63696f2ca2	5341c4e9-6e96-4f54-820e-f140c2f2b343	13	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
10f19c86-febe-46d9-b4ff-fbd9d3509793	5341c4e9-6e96-4f54-820e-f140c2f2b343	14	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
4a23add9-52ef-4699-9454-db7119a7e827	5341c4e9-6e96-4f54-820e-f140c2f2b343	15	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
deb71389-f33c-4d17-a302-5eced7ecf1b2	5341c4e9-6e96-4f54-820e-f140c2f2b343	16	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
887817b0-eaf0-40a3-9f67-6402c79e1e4e	5341c4e9-6e96-4f54-820e-f140c2f2b343	17	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
55ca2cb3-960d-4d47-8632-fed5a3e60d74	5341c4e9-6e96-4f54-820e-f140c2f2b343	18	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
1174a7af-4c8e-4fac-bb15-265d68bf4bf3	5341c4e9-6e96-4f54-820e-f140c2f2b343	19	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
79d6974c-f32b-4f31-b9ea-c43b11618b4b	5341c4e9-6e96-4f54-820e-f140c2f2b343	20	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
bc1d4cff-6643-4c1e-8e9d-efa48e536a24	5341c4e9-6e96-4f54-820e-f140c2f2b343	21	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
d698449a-4be1-4411-a2f5-700a2e2c3740	5341c4e9-6e96-4f54-820e-f140c2f2b343	22	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
f7463945-0624-4bba-b880-2c7498cbcb7e	5341c4e9-6e96-4f54-820e-f140c2f2b343	23	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
870f05b8-084b-4581-a96f-b030c7726e2e	5341c4e9-6e96-4f54-820e-f140c2f2b343	24	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
9573ffd8-1dbb-4336-bc51-5937fccd1b35	5341c4e9-6e96-4f54-820e-f140c2f2b343	25	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
0a368385-4cbc-4b5f-bb5f-19a19cf80a45	5341c4e9-6e96-4f54-820e-f140c2f2b343	26	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
057bd32a-0b26-4152-9ede-5595e694e2c4	5341c4e9-6e96-4f54-820e-f140c2f2b343	27	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
b201e566-a6ca-4c99-bbde-6ee4a8fc8acb	5341c4e9-6e96-4f54-820e-f140c2f2b343	28	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
886516c3-04ee-4a80-a5b2-1914414f8b03	5341c4e9-6e96-4f54-820e-f140c2f2b343	29	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
cf3a3b67-c6dd-4647-a0ea-31c4bb6a6fe5	5341c4e9-6e96-4f54-820e-f140c2f2b343	30	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
c6e82596-8001-4521-ae64-8466ddbed4c1	5341c4e9-6e96-4f54-820e-f140c2f2b343	31	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
b6b6c6d7-742d-4341-9682-483185fdf4df	5341c4e9-6e96-4f54-820e-f140c2f2b343	32	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
208c943f-6fef-4fa9-a205-03dd602d48c8	5341c4e9-6e96-4f54-820e-f140c2f2b343	33	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
a83fcce4-4666-4b54-ae22-a95e4704117c	5341c4e9-6e96-4f54-820e-f140c2f2b343	34	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
870063d9-1604-415c-a9ce-dc9f47547c2f	5341c4e9-6e96-4f54-820e-f140c2f2b343	35	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
defd4e56-33ce-4891-9d20-7602b94fb9d5	5341c4e9-6e96-4f54-820e-f140c2f2b343	36	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	trip	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07
bb037b98-fb57-45ff-b0f4-4acc7a4265cb	5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	1	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
c6dcef9d-8167-4de4-8474-5c6e470bb772	5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	2	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
cbb7b2ef-0129-46aa-8051-1d955575030f	5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	3	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
0085e8d1-04b7-4c03-9e6f-84d5e652ee49	5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	4	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
859bf2d6-c73c-455e-ac20-147424faf35c	5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	5	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
083a8bd9-6801-4262-b91b-beb19adea538	5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	6	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
3fa6482c-fe2a-474e-b29f-2cbf94635619	5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	7	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
dc79337e-62a2-4d4e-9496-dd91708a5ba2	5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	8	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
aea8f92b-8f52-4ab1-8bc3-3da8b6ac8e53	5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	9	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
e88fd237-6114-404f-ab13-096f15d91c41	5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	10	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
c8842fff-77b5-459f-8154-4a09156e3923	7726accb-e76d-40a5-a785-08d1334d40dc	1	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
c0eabde4-9d4f-40c1-87e6-ca69d583e828	7726accb-e76d-40a5-a785-08d1334d40dc	2	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
56eba3ec-18e3-433c-af66-c7ec7b943051	7726accb-e76d-40a5-a785-08d1334d40dc	3	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
f1013876-bfe9-40c4-bc8c-e61176b61f56	7726accb-e76d-40a5-a785-08d1334d40dc	4	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
bc9f39be-eb3a-4bed-8f9e-54a578439560	7726accb-e76d-40a5-a785-08d1334d40dc	5	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
d5aedadd-fcb1-4c7e-b118-7a5be450d707	7726accb-e76d-40a5-a785-08d1334d40dc	6	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
4cacd7eb-a251-466d-bf2e-07169e46f739	7726accb-e76d-40a5-a785-08d1334d40dc	7	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
ff488e9c-4750-40e4-a2ea-51da6cd0a1aa	7726accb-e76d-40a5-a785-08d1334d40dc	8	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
fa9f47e6-0b40-4d7d-ba33-f1943a9898f7	7726accb-e76d-40a5-a785-08d1334d40dc	9	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
67218772-b566-4128-b2af-30e734f22cd5	7726accb-e76d-40a5-a785-08d1334d40dc	10	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
e23279b9-9035-4e5c-b357-d5e6e044442b	1cc2fad1-060f-487c-9886-4f83bb82e07a	1	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
6e803fb1-f3d5-4aa4-b2c8-0ca8581ed340	1cc2fad1-060f-487c-9886-4f83bb82e07a	2	f76e1f39-3d7d-4638-9ebb-92d7af2d5290	\N	\N	\N	\N	road	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
acc9048f-b4cd-4878-8f69-36d97354f32a	d84546ed-9e9d-44fa-b7d8-0188940af80b	1	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
8995e155-710e-4f04-8149-8b46bd26ef62	d84546ed-9e9d-44fa-b7d8-0188940af80b	2	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
b1ed8fc8-214d-47e8-98ec-e342e00273d3	d84546ed-9e9d-44fa-b7d8-0188940af80b	3	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
86c5636c-6f35-4ba8-b590-68d1208151ab	d84546ed-9e9d-44fa-b7d8-0188940af80b	4	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
bf297d30-1fd2-46f4-8fc4-d3a640d0622e	d84546ed-9e9d-44fa-b7d8-0188940af80b	5	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
3f73b351-9402-4088-b775-6bb3b658545f	d84546ed-9e9d-44fa-b7d8-0188940af80b	6	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
d6f071b9-8054-4301-b7e2-7f20fad6db2e	d84546ed-9e9d-44fa-b7d8-0188940af80b	7	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
924a3173-247b-43be-97fe-c004e9403008	d84546ed-9e9d-44fa-b7d8-0188940af80b	8	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
678fb78f-44a9-4e8d-9669-e7637c928f3d	d84546ed-9e9d-44fa-b7d8-0188940af80b	9	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
7245b10a-44bf-4bc3-9099-723a240c7310	d84546ed-9e9d-44fa-b7d8-0188940af80b	10	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
93319243-f25e-4178-ac56-a4127d27ce51	d84546ed-9e9d-44fa-b7d8-0188940af80b	11	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
a1197603-985a-4616-9f51-ff2b8bc08296	d84546ed-9e9d-44fa-b7d8-0188940af80b	12	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
a3853a27-2606-4f9a-aeab-60c76e0f03d9	d84546ed-9e9d-44fa-b7d8-0188940af80b	13	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
127cdecb-75b7-4fb1-8bcf-6bfaa092bd6b	d84546ed-9e9d-44fa-b7d8-0188940af80b	14	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
9eb0d87c-8c6a-405b-a963-fbfc306248f9	d84546ed-9e9d-44fa-b7d8-0188940af80b	15	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
8f91a6fd-1909-4864-93e4-33c9565e7fca	d84546ed-9e9d-44fa-b7d8-0188940af80b	16	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
0c13d0de-47cf-4311-9fc9-e02c105f1052	d84546ed-9e9d-44fa-b7d8-0188940af80b	17	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
fc696bc6-d060-40ab-b50d-d8967e6a9cda	d84546ed-9e9d-44fa-b7d8-0188940af80b	18	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
380c3cf4-3252-4eed-88d6-6786f0279fcb	d84546ed-9e9d-44fa-b7d8-0188940af80b	19	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
4a151d65-4b0c-4980-b179-26a92c3d3174	d84546ed-9e9d-44fa-b7d8-0188940af80b	20	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
bd9bbd77-20f3-42b3-925b-bc3ac7b56dfd	d84546ed-9e9d-44fa-b7d8-0188940af80b	21	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
d5be4fe3-2cc7-4c39-bd58-8b391c6df243	d84546ed-9e9d-44fa-b7d8-0188940af80b	22	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
5cca1fc0-026d-4ad4-8df5-c1d230d43891	d84546ed-9e9d-44fa-b7d8-0188940af80b	23	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
35fb461f-e323-4a6d-b5e5-607fdf6eb7c8	d84546ed-9e9d-44fa-b7d8-0188940af80b	24	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
7c8033a2-6b13-42ba-bde5-fa2e74b607fd	d84546ed-9e9d-44fa-b7d8-0188940af80b	25	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
24b1d0f7-06c0-471a-a61a-f61ead16e2fe	d84546ed-9e9d-44fa-b7d8-0188940af80b	26	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
295a0fab-14a2-4b52-b305-4d09f2a4dd15	d84546ed-9e9d-44fa-b7d8-0188940af80b	27	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
d163cd4c-aedf-4d38-8464-703a06d66617	d84546ed-9e9d-44fa-b7d8-0188940af80b	28	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
1fc6d6e4-d173-4a8d-b380-1af1fdc9178a	d84546ed-9e9d-44fa-b7d8-0188940af80b	29	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:22:13.162861-07	2026-05-01 21:22:13.162861-07
2b381cca-f307-4fff-a0eb-99055c388163	6a5f6e24-d68a-47ef-98f0-00f017de7435	1	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
ae05ef5c-d57d-40ac-9d15-eb3eb266f2ff	6a5f6e24-d68a-47ef-98f0-00f017de7435	2	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
1feaeefb-c272-4370-b6a7-93af7b7a0c9f	6a5f6e24-d68a-47ef-98f0-00f017de7435	3	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
f4b4c0ca-25ea-4ef4-ad4e-be7383d85865	6a5f6e24-d68a-47ef-98f0-00f017de7435	4	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
14edd312-3a5e-49e6-90fa-b6e91119c855	6a5f6e24-d68a-47ef-98f0-00f017de7435	5	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
f04c2c0d-0158-48de-99e5-dd07c5cc90e3	6a5f6e24-d68a-47ef-98f0-00f017de7435	6	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
75694953-f147-4d1c-8ed3-4e574bfaedea	6a5f6e24-d68a-47ef-98f0-00f017de7435	7	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
7b124bd7-40a1-4eff-b990-d4c1ae372273	6a5f6e24-d68a-47ef-98f0-00f017de7435	8	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
6e83062f-4976-4565-9aa0-fab302e0cfe0	6a5f6e24-d68a-47ef-98f0-00f017de7435	9	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
7e550516-ff3e-4452-ad59-0de9f489e7e9	6a5f6e24-d68a-47ef-98f0-00f017de7435	10	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
e699dbd9-5f88-45c6-8f12-0050fb8f1a7d	6a5f6e24-d68a-47ef-98f0-00f017de7435	11	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
39cd69ad-ac85-49d2-9a15-35743d1e97d6	6a5f6e24-d68a-47ef-98f0-00f017de7435	12	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
5df159ae-5009-43f2-94e1-226f5d9905af	6a5f6e24-d68a-47ef-98f0-00f017de7435	13	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
95256662-ff61-4baf-96e4-55f8df00f46b	6a5f6e24-d68a-47ef-98f0-00f017de7435	14	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
42cdbc47-0386-4fe5-b858-24d7dbaaf717	6a5f6e24-d68a-47ef-98f0-00f017de7435	15	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
df1461f1-b642-4d64-9110-35650116d51e	6a5f6e24-d68a-47ef-98f0-00f017de7435	16	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
625ee0dc-eae3-4956-9047-308d37c0956f	6a5f6e24-d68a-47ef-98f0-00f017de7435	17	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
ecf2d539-df96-425d-a51c-419396e4ad7e	6a5f6e24-d68a-47ef-98f0-00f017de7435	18	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
cd3ac017-4982-4d63-b685-515890a2b2ba	6a5f6e24-d68a-47ef-98f0-00f017de7435	19	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
e3777c38-d31c-4eed-a16c-da6695165b65	6a5f6e24-d68a-47ef-98f0-00f017de7435	20	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
5ceb1c4c-2efd-4043-9de3-682dedc59ef4	6a5f6e24-d68a-47ef-98f0-00f017de7435	21	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
7932616f-f3b2-4800-b35a-8acff3b48281	6a5f6e24-d68a-47ef-98f0-00f017de7435	22	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
0b2635c8-73a9-43ed-ae9e-da1ed2090f05	6a5f6e24-d68a-47ef-98f0-00f017de7435	23	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
8faeb679-2141-4991-a288-2aa51613eeff	6a5f6e24-d68a-47ef-98f0-00f017de7435	24	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
c126b510-e9ee-47c8-ae68-af8c98fdf241	6a5f6e24-d68a-47ef-98f0-00f017de7435	25	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
8d7e8930-581d-4253-9ae3-aa39c7739cd7	6a5f6e24-d68a-47ef-98f0-00f017de7435	26	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
084f3b28-31d8-4524-b4f0-3cf1e09f4128	6a5f6e24-d68a-47ef-98f0-00f017de7435	27	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
c8d2959b-35a6-48af-80be-10cb08480488	6a5f6e24-d68a-47ef-98f0-00f017de7435	28	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
4418ae1e-7e5e-468e-b6af-5a98cd0f5235	6a5f6e24-d68a-47ef-98f0-00f017de7435	29	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
ef9819fb-f466-4a58-bb9f-232ff2cc76fb	6a5f6e24-d68a-47ef-98f0-00f017de7435	30	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
9c4bf078-b3cc-4065-b23d-24408803618f	6a5f6e24-d68a-47ef-98f0-00f017de7435	31	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
3c0aa259-59d3-4237-b7c1-5ee8e9d5a508	6a5f6e24-d68a-47ef-98f0-00f017de7435	32	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
6935b6a4-2812-4256-ad78-1d769178dcb0	6a5f6e24-d68a-47ef-98f0-00f017de7435	33	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
a0217378-59ac-4112-8c40-b54ca97c2272	6a5f6e24-d68a-47ef-98f0-00f017de7435	34	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
9786c228-a06b-495b-8103-0f4b3e796543	6a5f6e24-d68a-47ef-98f0-00f017de7435	35	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
9945103b-420f-4ed2-b2cb-9dc4127e84a7	6a5f6e24-d68a-47ef-98f0-00f017de7435	36	4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	\N	\N	\N	\N	no kings march	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:24:31.261199-07	2026-05-01 21:24:31.261199-07
7a65d250-8eb0-4cd1-896a-636bee16a6ef	303b7e9d-442d-454b-b7b4-4b3bbf92e889	1	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
a820fcae-af82-4e87-b01c-5c5bda509b97	303b7e9d-442d-454b-b7b4-4b3bbf92e889	2	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
a470b118-c5b0-4a49-9e35-89e55204c482	303b7e9d-442d-454b-b7b4-4b3bbf92e889	3	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
59383008-8f26-427f-8364-778c9acc1d2b	303b7e9d-442d-454b-b7b4-4b3bbf92e889	4	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
bc25905c-8b1e-426e-9bb6-5ea83efa2189	303b7e9d-442d-454b-b7b4-4b3bbf92e889	5	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
3d975269-a615-4a95-8f10-f2d87dedb1da	303b7e9d-442d-454b-b7b4-4b3bbf92e889	6	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
6fef74f2-e585-4e0b-8764-286fa96e8178	303b7e9d-442d-454b-b7b4-4b3bbf92e889	7	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
e6383a1e-0576-4a0c-81d0-64c520b25c2d	303b7e9d-442d-454b-b7b4-4b3bbf92e889	8	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
c9a43753-5072-4a8c-a40b-079301d5631d	303b7e9d-442d-454b-b7b4-4b3bbf92e889	9	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
396104c0-b501-4b61-8ab7-b7d40c7c4d17	303b7e9d-442d-454b-b7b4-4b3bbf92e889	10	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
deddcecd-aaff-4a0e-9eb4-08705bc642a2	303b7e9d-442d-454b-b7b4-4b3bbf92e889	11	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
ea122b29-8d59-4541-b1d7-34e868ee2d45	303b7e9d-442d-454b-b7b4-4b3bbf92e889	12	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
b7e2cc4a-107d-43e7-974b-534173b4d342	303b7e9d-442d-454b-b7b4-4b3bbf92e889	13	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
7d7abd3e-62a0-4ff9-a31c-6ea7302ebd89	303b7e9d-442d-454b-b7b4-4b3bbf92e889	14	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
472503a6-7050-41f2-97bc-7805065d36cf	303b7e9d-442d-454b-b7b4-4b3bbf92e889	15	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
77ab4822-c52b-4298-921a-6a543cb78417	303b7e9d-442d-454b-b7b4-4b3bbf92e889	16	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
63df8de9-479c-4d78-8be2-173d90398212	303b7e9d-442d-454b-b7b4-4b3bbf92e889	17	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
c4f7d9c7-060a-4004-8525-2bc6de97aa6b	303b7e9d-442d-454b-b7b4-4b3bbf92e889	18	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
b671f57c-f583-4ed7-a648-d8291b2fe673	303b7e9d-442d-454b-b7b4-4b3bbf92e889	19	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
651b311e-3c4b-46be-884d-a0c4222bb792	303b7e9d-442d-454b-b7b4-4b3bbf92e889	20	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
e926985d-2bf8-4d06-a1aa-4827401f2051	303b7e9d-442d-454b-b7b4-4b3bbf92e889	21	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
0527339a-d931-4cdd-8163-d7154c997906	303b7e9d-442d-454b-b7b4-4b3bbf92e889	22	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
2be5ec9a-7e03-4305-98bc-154d7b6e9cf7	303b7e9d-442d-454b-b7b4-4b3bbf92e889	23	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
66b3e954-1adf-4709-9e48-1133c0fa1688	303b7e9d-442d-454b-b7b4-4b3bbf92e889	24	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
2b6f3c9c-3ef1-44cb-9b27-094ddb503c86	303b7e9d-442d-454b-b7b4-4b3bbf92e889	25	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
206b181e-9a6c-4905-9577-ccd774a005b0	303b7e9d-442d-454b-b7b4-4b3bbf92e889	26	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
e5362a8e-5834-4a4c-9c17-b97042d6a222	303b7e9d-442d-454b-b7b4-4b3bbf92e889	27	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
2631c154-4190-4406-a4ab-571a9a95c710	303b7e9d-442d-454b-b7b4-4b3bbf92e889	28	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
3b231bf3-8712-4671-99c3-1cf40c6e157d	303b7e9d-442d-454b-b7b4-4b3bbf92e889	29	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
2837b91a-9c4c-4781-9ba4-15da3a0f378a	303b7e9d-442d-454b-b7b4-4b3bbf92e889	30	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
bfed3359-266b-463e-84ce-b2d1170e79ee	303b7e9d-442d-454b-b7b4-4b3bbf92e889	31	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
85ed4965-c7fa-465a-aaf2-45d5d11d0479	303b7e9d-442d-454b-b7b4-4b3bbf92e889	32	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
ae63eefb-5e2e-4770-ad27-d703416b56b9	303b7e9d-442d-454b-b7b4-4b3bbf92e889	33	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
cbde71b0-dbe0-4464-8eef-39ab8b1d31f1	303b7e9d-442d-454b-b7b4-4b3bbf92e889	34	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
326284c6-fbba-4a96-854c-97f96dabe311	303b7e9d-442d-454b-b7b4-4b3bbf92e889	35	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
350937a1-1d0b-4db6-b801-438d087df217	303b7e9d-442d-454b-b7b4-4b3bbf92e889	36	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
facce38d-a8f8-45b8-911e-0e774706b1de	c8803073-6f93-4c42-ac5d-d87268742ed6	1	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
1573682e-8bb8-47d7-b0f0-29b6239d33f9	c8803073-6f93-4c42-ac5d-d87268742ed6	2	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
3ba0bd47-96ff-4ec1-a204-428a7e1a33cb	c8803073-6f93-4c42-ac5d-d87268742ed6	3	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
dbe3f77a-06cf-49c4-a4c3-edfd3654d16c	c8803073-6f93-4c42-ac5d-d87268742ed6	4	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
f5cbebec-ac6d-4485-b6a6-eb08d6f70527	c8803073-6f93-4c42-ac5d-d87268742ed6	5	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
f4f12e19-c9fb-4e25-8274-b747aeb931d8	c8803073-6f93-4c42-ac5d-d87268742ed6	6	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
aa803a0c-dbed-43b1-b382-2ae5e29031d2	c8803073-6f93-4c42-ac5d-d87268742ed6	7	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
3ca7aab2-41d6-4907-9d1a-d8f57fad17c9	c8803073-6f93-4c42-ac5d-d87268742ed6	8	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
9fe4c59e-20d7-4352-a01c-5f72c80c6b41	c8803073-6f93-4c42-ac5d-d87268742ed6	9	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
23ef4c6b-682d-4f49-a214-c9ffb438285e	c8803073-6f93-4c42-ac5d-d87268742ed6	10	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
eeb44e74-5f40-4749-abe9-6e3db65b13df	c8803073-6f93-4c42-ac5d-d87268742ed6	11	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
18b745c6-580b-42c6-823c-e9122751ae95	c8803073-6f93-4c42-ac5d-d87268742ed6	12	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
44aaa43a-cb02-439e-84be-0833668fdc81	c8803073-6f93-4c42-ac5d-d87268742ed6	13	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
9fd7f171-2d3e-4556-aad2-331757df2abb	c8803073-6f93-4c42-ac5d-d87268742ed6	14	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
8c2005b0-11a4-4e56-89d0-f0b0c2fa03e5	c8803073-6f93-4c42-ac5d-d87268742ed6	15	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
955246c9-83cf-48dc-b7ae-b95a27560f8d	c8803073-6f93-4c42-ac5d-d87268742ed6	16	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
edb318be-19e8-4bac-8f86-dc2a977afde8	c8803073-6f93-4c42-ac5d-d87268742ed6	17	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
6ffc488f-8de5-460c-b2f8-49774e1a519d	c8803073-6f93-4c42-ac5d-d87268742ed6	18	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
ec5e3f1c-a440-4b20-bc9d-8aa43a5f1af3	c8803073-6f93-4c42-ac5d-d87268742ed6	19	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
092747dc-7d4d-4401-8fd1-e3c1be2d2eab	c8803073-6f93-4c42-ac5d-d87268742ed6	20	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
67611ce5-b85c-49be-8586-a6367e59f90a	c8803073-6f93-4c42-ac5d-d87268742ed6	21	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
dda4321e-feb7-4dcf-a4d1-117fe53e238c	c8803073-6f93-4c42-ac5d-d87268742ed6	22	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
4788efea-006f-409e-b060-069cfdc3e646	c8803073-6f93-4c42-ac5d-d87268742ed6	23	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
f8b6992b-0e3f-4355-a845-489405515c22	c8803073-6f93-4c42-ac5d-d87268742ed6	24	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
55c60a46-de5f-426a-8224-0df317ff3afc	c8803073-6f93-4c42-ac5d-d87268742ed6	25	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
3689a960-04a1-4929-bcd3-86c9963c1158	c8803073-6f93-4c42-ac5d-d87268742ed6	26	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
7e690e68-044a-49e9-a6a0-8e2a80d720fa	c8803073-6f93-4c42-ac5d-d87268742ed6	27	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
e9d0ef30-807f-4902-86ca-d449367e5d20	c8803073-6f93-4c42-ac5d-d87268742ed6	28	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
c95b55b8-d220-4de2-86ff-e05bf2d8f627	c8803073-6f93-4c42-ac5d-d87268742ed6	29	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
bf61de7e-7ede-48ce-956a-8cdedbfd0ee8	c8803073-6f93-4c42-ac5d-d87268742ed6	30	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
9569afde-0904-4cbd-b47e-89b0ba4bc62c	c8803073-6f93-4c42-ac5d-d87268742ed6	31	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
02ef660d-b9be-4aba-af9e-737a3897329d	c8803073-6f93-4c42-ac5d-d87268742ed6	32	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
775cf361-8ac1-4b38-a0f4-4add5f2d35f8	c8803073-6f93-4c42-ac5d-d87268742ed6	33	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
9f556757-3627-4734-bb5c-11674cda6f98	c8803073-6f93-4c42-ac5d-d87268742ed6	34	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
f59694eb-c851-4faa-b6bf-e7c90db8a2ff	c8803073-6f93-4c42-ac5d-d87268742ed6	35	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
6f9c33fd-dc5b-4c47-9e86-a0c691dde6e8	c8803073-6f93-4c42-ac5d-d87268742ed6	36	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	Portland	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07
9d4656c5-6bcf-4e72-a349-c9ae1ce96059	8bee5acb-65c4-4306-85b8-b5a519709741	1	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
5a5a87ab-e75d-4904-b226-8e7f6050ebd2	8bee5acb-65c4-4306-85b8-b5a519709741	2	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
f95b462e-0188-43f5-b4fb-abecb59ab777	8bee5acb-65c4-4306-85b8-b5a519709741	3	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
7a299919-834c-4a47-89b9-2de0e52ffa8b	8bee5acb-65c4-4306-85b8-b5a519709741	4	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
921ae7ff-f224-4293-8f7b-be80382083a2	8bee5acb-65c4-4306-85b8-b5a519709741	5	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
c83f795e-d12d-4cf3-ba0b-fbc3c78bd48f	8bee5acb-65c4-4306-85b8-b5a519709741	6	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
b122943f-9c73-41a1-9953-835019d61120	8bee5acb-65c4-4306-85b8-b5a519709741	7	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
429da9ef-5282-43d7-9c5a-ea049bd6b66a	8bee5acb-65c4-4306-85b8-b5a519709741	8	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
fcf1c008-d44d-4b67-a04b-6f0b40f87e9b	8bee5acb-65c4-4306-85b8-b5a519709741	9	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
3249a78d-eb83-4cef-92df-c6b7004e5a1d	8bee5acb-65c4-4306-85b8-b5a519709741	10	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
814079b7-728c-4eaa-903d-fb45ecd2dce4	8bee5acb-65c4-4306-85b8-b5a519709741	11	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
97b3de2b-06be-48c9-8d02-67ec1906ae2e	8bee5acb-65c4-4306-85b8-b5a519709741	12	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
545e469c-6388-4032-84c6-165807db1294	8bee5acb-65c4-4306-85b8-b5a519709741	13	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
85139b27-06c5-405a-8752-84806b9d0ab9	8bee5acb-65c4-4306-85b8-b5a519709741	14	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
86d784e2-9ecf-48d1-8245-5325818fb4c2	8bee5acb-65c4-4306-85b8-b5a519709741	15	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
2d5c0125-e278-4021-b7a4-e6261144396f	8bee5acb-65c4-4306-85b8-b5a519709741	16	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
116d115c-2e4a-42b5-b125-81c910cc1f66	8bee5acb-65c4-4306-85b8-b5a519709741	17	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
6be45212-b3d9-4728-98b1-7a0f01e44c86	8bee5acb-65c4-4306-85b8-b5a519709741	18	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
8107a3c4-64e8-4958-8187-4316f808a522	8bee5acb-65c4-4306-85b8-b5a519709741	19	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
301ac25e-2643-46fa-85b3-46d02d9f6ae8	8bee5acb-65c4-4306-85b8-b5a519709741	20	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
965c48a7-f5ef-4f07-ad79-527d30e561af	8bee5acb-65c4-4306-85b8-b5a519709741	21	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
6825ea9d-0972-4519-8745-3067899573ee	8bee5acb-65c4-4306-85b8-b5a519709741	22	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
422f095a-095d-4c7b-8163-69077efb6848	8bee5acb-65c4-4306-85b8-b5a519709741	23	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
95092d78-c357-47ad-a78c-a0d82426bbce	8bee5acb-65c4-4306-85b8-b5a519709741	24	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
f017590a-ee29-4cd3-9d54-ee61c632cd9e	8bee5acb-65c4-4306-85b8-b5a519709741	25	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
9ab409b8-b3f6-4ea1-a805-d9151bb3da49	8bee5acb-65c4-4306-85b8-b5a519709741	26	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
d0904ca3-837f-4832-8507-acd298174cf0	8bee5acb-65c4-4306-85b8-b5a519709741	27	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
4995f24e-2340-400f-9ee2-7184d4291bac	8bee5acb-65c4-4306-85b8-b5a519709741	28	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
54a9d8e5-060c-4447-814a-72db768ddac0	8bee5acb-65c4-4306-85b8-b5a519709741	29	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
68b164ee-99bb-4b03-b1cc-d2475194f0bf	8bee5acb-65c4-4306-85b8-b5a519709741	30	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
b4c7da0d-3c25-4bd3-8889-d80ad2f9553b	8bee5acb-65c4-4306-85b8-b5a519709741	31	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
700aee9e-6ac4-469b-8b6f-88082c5289b1	8bee5acb-65c4-4306-85b8-b5a519709741	32	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
61b88e5b-900b-4c71-a6d6-561806c2d191	8bee5acb-65c4-4306-85b8-b5a519709741	33	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
8055a849-722c-46d9-bc22-ceb249b3665b	8bee5acb-65c4-4306-85b8-b5a519709741	34	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
0120e6c8-2881-45a1-a97d-40070b3f64b7	8bee5acb-65c4-4306-85b8-b5a519709741	35	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
76c66c83-a3bb-444d-aae8-83e7e8a26815	8bee5acb-65c4-4306-85b8-b5a519709741	36	0b3d2996-d8e0-4c06-acb4-739a08714409	\N	\N	\N	\N	hood canal	\N	\N	\N	\N	\N	{}	\N	f	2026-05-01 21:51:55.712688-07	2026-05-01 21:51:55.712688-07
\.


--
-- Data for Name: lenses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lenses (id, user_id, make, model, focal_length_mm, max_aperture, serial_number, notes, is_active, created_at, updated_at) FROM stdin;
2bfe90b8-f4e1-4e12-9f08-88c2318a8703	d43eded1-69f1-427d-a695-70dbe56b69ef	Leica	Summicron V3	50	2	\N	\N	t	2026-03-30 19:20:46.446001-07	2026-03-30 19:20:46.446001-07
0b3d2996-d8e0-4c06-acb4-739a08714409	d43eded1-69f1-427d-a695-70dbe56b69ef	Voigtlander	Nokton	40	1.4	\N	\N	t	2026-03-30 19:20:46.466937-07	2026-03-30 19:20:46.466937-07
4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	d43eded1-69f1-427d-a695-70dbe56b69ef	Voigtlander	Color Skopar	28	2.8	\N	\N	t	2026-03-30 19:20:46.473649-07	2026-03-30 19:21:33.8-07
f76e1f39-3d7d-4638-9ebb-92d7af2d5290	d43eded1-69f1-427d-a695-70dbe56b69ef	Mamiya	N 80mm f/4 L	80	\N	\N	\N	t	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07
\.


--
-- Data for Name: notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notes (id, user_id, roll_id, frame_id, type, content, file_key, file_url, thumbnail_url, duration_seconds, mime_type, file_size_bytes, latitude, longitude, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: rolls; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rolls (id, user_id, camera_id, film_stock_id, status, loaded_at, rated_iso, push_pull_stops, frame_count, title, description, tags, created_at, updated_at, format, form, unloaded_at, display_id) FROM stdin;
5341c4e9-6e96-4f54-820e-f140c2f2b343	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	79fad1b7-75b1-42c2-a934-4b6557f2d2c3	unloaded	2026-04-16 10:25:00-07	50	\N	36	\N	\N	{}	2026-05-01 20:52:37.93144-07	2026-05-01 20:52:37.93144-07	35mm	factory_roll	2026-04-16 10:28:00-07	20260416.02
5f9d581a-7e7a-4ed8-8e4b-b0c1ddd8dc91	d43eded1-69f1-427d-a695-70dbe56b69ef	3916c853-860d-425c-a436-8560756da3cd	aee798ee-c90b-43dd-a85a-57b795d33dfd	unloaded	2026-04-20 09:00:00-07	400	\N	10	\N	\N	{}	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07	120	factory_roll	2026-04-20 11:09:00-07	20260420.02
7726accb-e76d-40a5-a785-08d1334d40dc	d43eded1-69f1-427d-a695-70dbe56b69ef	3916c853-860d-425c-a436-8560756da3cd	aee798ee-c90b-43dd-a85a-57b795d33dfd	unloaded	2026-04-20 09:00:00-07	400	\N	10	\N	\N	{}	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07	120	factory_roll	2026-04-20 11:09:00-07	20260420.03
1cc2fad1-060f-487c-9886-4f83bb82e07a	d43eded1-69f1-427d-a695-70dbe56b69ef	3916c853-860d-425c-a436-8560756da3cd	aee798ee-c90b-43dd-a85a-57b795d33dfd	loaded	2026-04-20 11:09:00-07	400	\N	10	\N	\N	{}	2026-05-01 21:00:24.806215-07	2026-05-01 21:00:24.806215-07	120	factory_roll	\N	\N
399a2c05-8c32-477c-8b7c-64b2eb6e27bf	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	3b66f352-2912-4921-a189-300b8a6bc8cc	unloaded	2026-04-15 09:46:00-07	100	\N	36	\N	\N	{}	2026-05-01 20:52:37.93144-07	2026-05-01 21:02:03.646349-07	35mm	factory_roll	2026-04-16 10:25:00-07	20260416.01
5ca74b64-05a1-45a7-b243-dc297e4a22d9	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	42f44ce0-b4a1-45f4-835d-7845d983bb2b	unloaded	\N	3200	\N	36	\N	found exposed; camera/load/unload dates unknown — develop blind	{}	2026-05-01 21:13:37.65157-07	2026-05-01 21:13:37.65157-07	35mm	factory_roll	\N	20260501.05
b51caa5b-f511-4594-bef6-3dc01d5d8778	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	loaded	2026-04-12 19:16:54.149-07	100	\N	1	\N	\N	{}	2026-04-12 19:16:54.149393-07	2026-04-12 19:16:54.149393-07	4x5	sheet	\N	\N
0aac1606-5a2d-4347-8e04-5820ffcf4986	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	loaded	2026-04-12 19:16:54.168-07	100	\N	1	\N	\N	{}	2026-04-12 19:16:54.168696-07	2026-04-12 19:16:54.168696-07	4x5	sheet	\N	\N
c3f00efa-4224-4776-8be7-96f220497e39	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	aee798ee-c90b-43dd-a85a-57b795d33dfd	loaded	2026-04-12 19:16:54.188-07	400	\N	1	\N	\N	{}	2026-04-12 19:16:54.188955-07	2026-04-12 19:16:54.188955-07	4x5	sheet	\N	\N
40416e6b-f769-4b38-8976-1db2856db869	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	aee798ee-c90b-43dd-a85a-57b795d33dfd	loaded	2026-04-12 19:16:54.21-07	400	\N	1	\N	\N	{}	2026-04-12 19:16:54.210708-07	2026-04-12 19:16:54.210708-07	4x5	sheet	\N	\N
4cfe53b2-cfbc-4dfa-a458-ac99b09dd3e6	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	loaded	2026-05-01 20:19:47.417292-07	100	\N	1	\N	\N	{}	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07	4x5	sheet	\N	\N
379caf8e-32bd-418c-8035-5c47fc292fc4	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	loaded	2026-05-01 20:19:47.417292-07	100	\N	1	\N	\N	{}	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07	4x5	sheet	\N	\N
88ee7100-bed6-45b4-bffa-7c5b133d04f5	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	loaded	2026-05-01 20:19:47.417292-07	100	\N	1	\N	\N	{}	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07	4x5	sheet	\N	\N
70292ad2-1a0c-4d23-864e-db4f5788ef3b	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	loaded	2026-05-01 20:19:47.417292-07	100	\N	1	\N	\N	{}	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07	4x5	sheet	\N	\N
d9a2f1b2-7012-4928-a279-e1156cf3c1e9	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	loaded	2026-05-01 20:19:47.417292-07	100	\N	1	\N	\N	{}	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07	4x5	sheet	\N	\N
b20f7bb4-7531-4a50-abfc-0155f7232f0d	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	loaded	2026-05-01 20:19:47.417292-07	100	\N	1	\N	\N	{}	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07	4x5	sheet	\N	\N
05038e1b-9aa2-4a83-96e2-657fb318654a	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	loaded	2026-05-01 20:19:47.417292-07	100	\N	1	\N	\N	{}	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07	4x5	sheet	\N	\N
f49bef4e-800f-44f8-87c4-bb0873e71a30	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	badc259c-4762-45b3-9017-cfeabffdd00d	unloaded	2026-03-28 14:32:00-07	400	\N	36	\N	\N	{}	2026-05-01 20:52:37.93144-07	2026-05-01 21:18:04.381586-07	35mm	factory_roll	2026-04-15 09:46:00-07	20260415.01
d228c9da-af9e-4260-9046-1e850955d026	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	bce2b5c9-2d4c-467c-9352-de43c2ee7023	loaded	2026-05-01 20:31:06.312896-07	5	\N	29	\N	\N	{}	2026-05-01 20:31:06.312896-07	2026-05-01 20:31:06.312896-07	35mm	factory_roll	\N	\N
167302f3-f2ff-4a66-b015-ae2c4f39a0d7	d43eded1-69f1-427d-a695-70dbe56b69ef	10424cc8-84ad-492a-a8e1-1171d3bd6c80	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	unloaded	2026-04-12 19:11:15.148-07	100	\N	1	\N	\N	{}	2026-04-12 19:11:15.148541-07	2026-04-12 19:11:15.186-07	4x5	sheet	2026-04-12 19:11:15.186-07	20260412.01
f3c1eee9-8a7a-485f-9413-c7c170c7b278	d43eded1-69f1-427d-a695-70dbe56b69ef	10424cc8-84ad-492a-a8e1-1171d3bd6c80	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	unloaded	2026-04-12 19:11:15.207-07	100	\N	1	\N	\N	{}	2026-04-12 19:11:15.207969-07	2026-04-12 19:11:15.247-07	4x5	sheet	2026-04-12 19:11:15.247-07	20260412.02
9a48fe91-34a3-4d71-bf3b-638aad97f3dd	d43eded1-69f1-427d-a695-70dbe56b69ef	10424cc8-84ad-492a-a8e1-1171d3bd6c80	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	unloaded	2026-05-01 20:19:47.417292-07	100	\N	1	\N	\N	{}	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07	4x5	sheet	2026-05-01 20:19:47.417292-07	20260501.01
a69124fc-0b51-46c8-a9e5-a3f12dcd42cf	d43eded1-69f1-427d-a695-70dbe56b69ef	10424cc8-84ad-492a-a8e1-1171d3bd6c80	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	unloaded	2026-05-01 20:19:47.417292-07	100	\N	1	\N	\N	{}	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07	4x5	sheet	2026-05-01 20:19:47.417292-07	20260501.02
f0f11095-d728-4b74-b051-f31cd5aecd20	d43eded1-69f1-427d-a695-70dbe56b69ef	10424cc8-84ad-492a-a8e1-1171d3bd6c80	02c35ea6-8d7d-42a6-bb27-84c80678f4b5	unloaded	2026-05-01 20:19:47.417292-07	100	\N	1	\N	\N	{}	2026-05-01 20:19:47.417292-07	2026-05-01 20:19:47.417292-07	4x5	sheet	2026-05-01 20:19:47.417292-07	20260501.03
4ee18a92-4938-4ee2-b177-5452946c3ac9	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	c6b4d18a-c0a3-4420-80e4-ab6e57b9739c	unloaded	2026-04-20 12:00:00-07	80	\N	36	\N	\N	{}	2026-05-01 20:28:59.936075-07	2026-05-01 20:28:59.936075-07	35mm	factory_roll	2026-05-01 12:47:00-07	20260501.04
da250e1e-fb73-4263-b6d2-25ed81106fb0	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	f228f76e-d873-4eb5-8bac-cbe79fa0d422	unloaded	2026-04-19 18:09:00-07	100	\N	36	\N	\N	{}	2026-05-01 20:40:37.523105-07	2026-05-01 20:41:34.712355-07	35mm	factory_roll	2026-04-20 13:19:00-07	20260420.01
7099e680-3cdf-4da0-b790-f6630c94b851	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	bce2b5c9-2d4c-467c-9352-de43c2ee7023	unloaded	\N	5	\N	29	\N	load date unknown	{}	2026-05-01 20:44:30.971997-07	2026-05-01 20:44:30.971997-07	35mm	factory_roll	2026-04-19 18:03:00-07	20260419.01
d84546ed-9e9d-44fa-b7d8-0188940af80b	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	bce2b5c9-2d4c-467c-9352-de43c2ee7023	unloaded	2026-03-28 09:00:00-07	5	\N	29	\N	\N	{}	2026-05-01 21:22:13.162861-07	2026-05-01 21:28:46.454428-07	35mm	factory_roll	2026-03-28 13:35:00-07	20260328.01
6a5f6e24-d68a-47ef-98f0-00f017de7435	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	81fff50e-94b7-4cc7-9c23-a1c2937bc82a	unloaded	2026-03-28 09:00:00-07	400	1.0	36	\N	physical mapping uncertain — two Kentmere Pan 200 cassettes recovered; subjects/identity cross-check vs 20260501.06 at dev time	{}	2026-05-01 21:24:31.261199-07	2026-05-01 21:28:46.454428-07	35mm	factory_roll	2026-03-28 13:34:00-07	20260328.02
56751a94-2af4-40c5-838d-8c7b9988a551	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	81fff50e-94b7-4cc7-9c23-a1c2937bc82a	unloaded	\N	400	1.0	36	\N	second Kentmere Pan 200 cassette of unknown origin — possibly swappable with 20260328.02; will develop as if shot at 400 (+1 push)	{}	2026-05-01 21:28:46.454428-07	2026-05-01 21:29:38.402967-07	35mm	factory_roll	\N	20260501.06
7f960c4b-3a9c-4f54-8682-612ee1962284	d43eded1-69f1-427d-a695-70dbe56b69ef	\N	3b66f352-2912-4921-a189-300b8a6bc8cc	unloaded	\N	100	\N	36	\N	found exposed, pre-trip; camera/load/unload dates unknown	{}	2026-05-01 21:39:13.184191-07	2026-05-01 21:39:13.184191-07	35mm	factory_roll	\N	20260501.07
303b7e9d-442d-454b-b7b4-4b3bbf92e889	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	aee798ee-c90b-43dd-a85a-57b795d33dfd	unloaded	\N	400	\N	36	\N	load date unknown	{}	2026-05-01 21:46:48.961918-07	2026-05-01 21:46:48.961918-07	35mm	factory_roll	2026-02-21 16:23:00-08	20260221.01
8bee5acb-65c4-4306-85b8-b5a519709741	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	81cf5142-c23e-4f7e-b7ff-3754e0f344ed	unloaded	\N	400	\N	36	\N	lens and subject uncertain	{}	2026-05-01 21:47:52.704463-07	2026-05-01 21:51:55.712688-07	35mm	factory_roll	2026-02-15 11:49:00-08	20260215.01
c8803073-6f93-4c42-ac5d-d87268742ed6	d43eded1-69f1-427d-a695-70dbe56b69ef	ecf85b27-a4e7-4233-b94e-06321e569c7f	a30739bc-efc7-479f-a250-1f093df8f73b	unloaded	2026-02-22 14:23:00-08	400	\N	36	\N	Portland trip; 2026-02-22 14:23 snap could be load or unload — exact timing unclear; tag aligned with HP5 (.01)	{}	2026-05-01 21:46:48.961918-07	2026-05-01 21:53:25.890364-07	35mm	factory_roll	\N	20260221.02
\.


--
-- Data for Name: scanners; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scanners (id, user_id, make, model, notes, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: scans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.scans (id, frame_id, scanner_id, file_key, file_url, thumbnail_url, original_filename, mime_type, file_size_bytes, width_px, height_px, dpi, bit_depth, color_space, post_processing_notes, is_primary, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, password_hash, display_name, created_at, updated_at) FROM stdin;
c0fe3ff9-a993-4021-95f0-3f782e4038e0	stout@filmlog.dev	$2b$12$3ve.p3RX1Cm2V6RlZ1vgF.T8c/uG14fg5ni8B3ouhZTuZH42L2iaK	\N	2026-03-30 18:17:30.236254-07	2026-03-30 18:17:30.236254-07
d43eded1-69f1-427d-a695-70dbe56b69ef	stout@tomu.dev	$2b$12$0uzDMOV.tLarK79KT7lXs.byUUPy4nkwjEohORUWKsyIYoVp6yM3.	\N	2026-03-30 18:59:03.790743-07	2026-03-30 18:59:03.790743-07
\.


--
-- Name: camera_lenses camera_lenses_camera_id_lens_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_lenses
    ADD CONSTRAINT camera_lenses_camera_id_lens_id_unique UNIQUE (camera_id, lens_id);


--
-- Name: cameras cameras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cameras
    ADD CONSTRAINT cameras_pkey PRIMARY KEY (id);


--
-- Name: development_logs development_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.development_logs
    ADD CONSTRAINT development_logs_pkey PRIMARY KEY (id);


--
-- Name: development_logs development_logs_roll_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.development_logs
    ADD CONSTRAINT development_logs_roll_id_unique UNIQUE (roll_id);


--
-- Name: film_inventory film_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.film_inventory
    ADD CONSTRAINT film_inventory_pkey PRIMARY KEY (id);


--
-- Name: film_stocks film_stocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.film_stocks
    ADD CONSTRAINT film_stocks_pkey PRIMARY KEY (id);


--
-- Name: frames frames_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.frames
    ADD CONSTRAINT frames_pkey PRIMARY KEY (id);


--
-- Name: frames frames_roll_id_frame_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.frames
    ADD CONSTRAINT frames_roll_id_frame_number_unique UNIQUE (roll_id, frame_number);


--
-- Name: lenses lenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lenses
    ADD CONSTRAINT lenses_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: rolls rolls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rolls
    ADD CONSTRAINT rolls_pkey PRIMARY KEY (id);


--
-- Name: scanners scanners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scanners
    ADD CONSTRAINT scanners_pkey PRIMARY KEY (id);


--
-- Name: scans scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: film_inventory_user_display_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX film_inventory_user_display_id_unique ON public.film_inventory USING btree (user_id, display_id) WHERE (display_id IS NOT NULL);


--
-- Name: camera_lenses camera_lenses_camera_id_cameras_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_lenses
    ADD CONSTRAINT camera_lenses_camera_id_cameras_id_fk FOREIGN KEY (camera_id) REFERENCES public.cameras(id) ON DELETE CASCADE;


--
-- Name: camera_lenses camera_lenses_lens_id_lenses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_lenses
    ADD CONSTRAINT camera_lenses_lens_id_lenses_id_fk FOREIGN KEY (lens_id) REFERENCES public.lenses(id) ON DELETE CASCADE;


--
-- Name: cameras cameras_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cameras
    ADD CONSTRAINT cameras_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: development_logs development_logs_roll_id_rolls_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.development_logs
    ADD CONSTRAINT development_logs_roll_id_rolls_id_fk FOREIGN KEY (roll_id) REFERENCES public.rolls(id) ON DELETE CASCADE;


--
-- Name: film_inventory film_inventory_film_stock_id_film_stocks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.film_inventory
    ADD CONSTRAINT film_inventory_film_stock_id_film_stocks_id_fk FOREIGN KEY (film_stock_id) REFERENCES public.film_stocks(id) ON DELETE CASCADE;


--
-- Name: film_inventory film_inventory_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.film_inventory
    ADD CONSTRAINT film_inventory_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: film_stocks film_stocks_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.film_stocks
    ADD CONSTRAINT film_stocks_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: frames frames_lens_id_lenses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.frames
    ADD CONSTRAINT frames_lens_id_lenses_id_fk FOREIGN KEY (lens_id) REFERENCES public.lenses(id);


--
-- Name: frames frames_roll_id_rolls_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.frames
    ADD CONSTRAINT frames_roll_id_rolls_id_fk FOREIGN KEY (roll_id) REFERENCES public.rolls(id) ON DELETE CASCADE;


--
-- Name: lenses lenses_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lenses
    ADD CONSTRAINT lenses_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: notes notes_frame_id_frames_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_frame_id_frames_id_fk FOREIGN KEY (frame_id) REFERENCES public.frames(id) ON DELETE CASCADE;


--
-- Name: notes notes_roll_id_rolls_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_roll_id_rolls_id_fk FOREIGN KEY (roll_id) REFERENCES public.rolls(id) ON DELETE CASCADE;


--
-- Name: notes notes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: rolls rolls_camera_id_cameras_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rolls
    ADD CONSTRAINT rolls_camera_id_cameras_id_fk FOREIGN KEY (camera_id) REFERENCES public.cameras(id);


--
-- Name: rolls rolls_film_stock_id_film_stocks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rolls
    ADD CONSTRAINT rolls_film_stock_id_film_stocks_id_fk FOREIGN KEY (film_stock_id) REFERENCES public.film_stocks(id);


--
-- Name: rolls rolls_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rolls
    ADD CONSTRAINT rolls_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: scanners scanners_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scanners
    ADD CONSTRAINT scanners_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: scans scans_frame_id_frames_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_frame_id_frames_id_fk FOREIGN KEY (frame_id) REFERENCES public.frames(id) ON DELETE CASCADE;


--
-- Name: scans scans_scanner_id_scanners_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_scanner_id_scanners_id_fk FOREIGN KEY (scanner_id) REFERENCES public.scanners(id);


--
-- PostgreSQL database dump complete
--

\unrestrict llMEOhLBw8ZmFXE8WKTTXiykqOm2EqSYFeFdPNZp1Jb4lzNH3K5McXT8dRAc9vN

