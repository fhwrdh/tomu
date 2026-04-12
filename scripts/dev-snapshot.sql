--
-- PostgreSQL database dump
--

\restrict JuJeDrojXpEC9JvF4i95rax7Ze8OOUOgZO3k8xpJ053WZKtFtPd71e9JQdI7bJD

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
5a97b16a-c87f-406e-a7d9-a5deaa6f91b0	d43eded1-69f1-427d-a695-70dbe56b69ef	bce2b5c9-2d4c-467c-9352-de43c2ee7023	9	\N	fridge	\N	\N	\N	2026-04-11 16:11:22.465974-07	2026-04-11 16:11:22.465974-07	35mm	factory_roll	\N	\N	\N	\N	\N
7180d050-760b-41a1-95e7-45a7ba945fba	d43eded1-69f1-427d-a695-70dbe56b69ef	bd77c711-8ca6-4b25-9a59-edf4513fb6f1	1	\N	fridge	\N	\N	\N	2026-04-11 16:16:25.867999-07	2026-04-11 16:16:25.867999-07	35mm	factory_roll	\N	\N	\N	\N	\N
a3822a4d-10d5-4dca-b716-152780034b48	d43eded1-69f1-427d-a695-70dbe56b69ef	ed42bb5c-f728-4dcc-8351-36578fbc7563	2	\N	fridge	\N	\N	\N	2026-04-11 16:18:33.656094-07	2026-04-11 16:18:33.656094-07	35mm	factory_roll	\N	\N	\N	\N	\N
5faecf1d-bb59-4398-960f-fe7b8fd0c579	d43eded1-69f1-427d-a695-70dbe56b69ef	c6b4d18a-c0a3-4420-80e4-ab6e57b9739c	1	\N	fridge	\N	\N	\N	2026-04-11 16:23:31.827339-07	2026-04-11 16:23:31.827339-07	35mm	factory_roll	\N	\N	\N	\N	\N
4f678e2c-19db-47a4-8323-de399607a42f	d43eded1-69f1-427d-a695-70dbe56b69ef	42f44ce0-b4a1-45f4-835d-7845d983bb2b	1	\N	fridge	\N	\N	\N	2026-04-11 16:23:31.858326-07	2026-04-11 16:23:31.858326-07	35mm	factory_roll	\N	\N	\N	\N	\N
1f9e6e84-0265-4403-8147-8fd99e5cf85b	d43eded1-69f1-427d-a695-70dbe56b69ef	e388e75a-5ca1-447f-adb9-0358ab3e8671	1	\N	fridge	\N	\N	\N	2026-04-11 16:23:31.886553-07	2026-04-11 16:23:31.886553-07	35mm	factory_roll	\N	\N	\N	\N	\N
97294346-4de8-4ee2-9c70-a499c8492655	d43eded1-69f1-427d-a695-70dbe56b69ef	a1a136a7-d66a-46cd-9433-ff106fe3f3b9	1	\N	fridge	\N	\N	\N	2026-04-11 16:23:31.893264-07	2026-04-11 16:23:31.893264-07	35mm	factory_roll	\N	\N	\N	\N	\N
81c13197-9c0d-4580-b1a0-9f5177eec029	d43eded1-69f1-427d-a695-70dbe56b69ef	dafa9ff9-bd57-4a11-b77e-09ffe83f3e78	1	\N	fridge	\N	\N	\N	2026-04-11 16:23:31.920681-07	2026-04-11 16:23:31.920681-07	35mm	factory_roll	\N	\N	\N	\N	\N
deafa787-f828-44a8-a7a7-f90087bc93d7	d43eded1-69f1-427d-a695-70dbe56b69ef	aee798ee-c90b-43dd-a85a-57b795d33dfd	4	\N	fridge	\N	\N	bulk-spooled cassettes	2026-04-11 16:26:52.67673-07	2026-04-11 16:26:52.67673-07	35mm	factory_roll	\N	\N	24	\N	\N
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
ade71f34-d34f-42da-900c-83fa4a4e39c9	d43eded1-69f1-427d-a695-70dbe56b69ef	79fad1b7-75b1-42c2-a934-4b6557f2d2c3	1	\N	fridge	\N	\N	\N	2026-04-11 17:29:19.229121-07	2026-04-11 17:29:19.229121-07	35mm	factory_roll	\N	\N	\N	\N	\N
9987f14d-26b2-4151-b82a-63212fee0613	d43eded1-69f1-427d-a695-70dbe56b69ef	3818009d-c3de-40f1-82c9-c9f6f9413ede	1	1992	fridge	\N	\N	\N	2026-04-11 17:30:53.321673-07	2026-04-11 17:30:53.321673-07	35mm	factory_roll	\N	\N	\N	\N	\N
e437233e-1cd1-4755-a919-c3f5b94c63c0	d43eded1-69f1-427d-a695-70dbe56b69ef	f228f76e-d873-4eb5-8bac-cbe79fa0d422	1	\N	fridge	\N	\N	\N	2026-04-11 17:32:44.434066-07	2026-04-11 17:32:44.434066-07	35mm	factory_roll	\N	\N	\N	\N	\N
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
faec8699-58d8-433d-9a7b-c0b220b89d4d	d43eded1-69f1-427d-a695-70dbe56b69ef	81fff50e-94b7-4cc7-9c23-a1c2937bc82a	1	\N	fridge	\N	\N	In canister, no box. Possibly partially shot — treating as unshot, any double exposures are a feature.	2026-04-11 17:59:14.998544-07	2026-04-11 17:59:15.026-07	35mm	factory_roll	\N	\N	\N	R008	\N
0ad3dd5d-0aab-443e-9f4e-9bff16e58409	d43eded1-69f1-427d-a695-70dbe56b69ef	ea8830a4-12ed-4201-9991-446a25d173ee	1	1998	fridge	\N	\N	Mystery 20-exposure roll, hand-written ISO 400 on cassette, expired 1998. User-rated ISO 25 to compensate.	2026-04-11 18:03:30.725772-07	2026-04-11 18:03:30.747-07	35mm	factory_roll	\N	\N	20	R009	25
6eaaeeb0-adb6-47c5-a7a3-1a2e74fa482f	d43eded1-69f1-427d-a695-70dbe56b69ef	b28883e1-0938-4b04-b060-545bc4d21f66	1	\N	fridge	\N	\N	Rolled up in cassette, leader inside. Believed fresh/unshot.	2026-04-11 18:04:28.202838-07	2026-04-11 18:04:28.225-07	35mm	factory_roll	\N	\N	\N	R010	\N
04b03489-55df-4d6f-ad53-c65667edd084	d43eded1-69f1-427d-a695-70dbe56b69ef	d41801c0-113a-487e-bcef-35af2d89d079	1	\N	fridge	\N	\N	In a reused Kentmere 400 canister — NOT actually Kentmere 400. Best guess HP5 or FP4 based on feel/source. Fresh. Stand dev planned. Frame count uncertain (24?).	2026-04-11 18:07:56.671108-07	2026-04-11 18:07:56.692-07	35mm	factory_roll	\N	\N	24	R011	\N
05023095-a2ca-413e-9c44-605ea98f5565	d43eded1-69f1-427d-a695-70dbe56b69ef	01feb6be-5390-433a-88ce-6d57a97e73f9	1	\N	fridge	\N	\N	Very old, unknown stock. Stand dev in Rodinal. Unknown frame count.	2026-04-11 18:10:07.491257-07	2026-04-11 18:10:07.556-07	35mm	factory_roll	\N	\N	\N	R014	25
8d367275-8ed4-4e47-bd88-46752103c0ff	d43eded1-69f1-427d-a695-70dbe56b69ef	01feb6be-5390-433a-88ce-6d57a97e73f9	1	\N	fridge	\N	\N	Very old, unknown stock. Stand dev in Rodinal. Unknown frame count.	2026-04-11 18:10:07.515524-07	2026-04-11 18:10:07.515524-07	35mm	factory_roll	\N	\N	\N	R012	25
fffeb0a3-0c9f-4dae-8518-8a90881da9b0	d43eded1-69f1-427d-a695-70dbe56b69ef	01feb6be-5390-433a-88ce-6d57a97e73f9	1	\N	fridge	\N	\N	Very old, unknown stock. Stand dev in Rodinal. Unknown frame count.	2026-04-11 18:10:07.536222-07	2026-04-11 18:10:07.536222-07	35mm	factory_roll	\N	\N	\N	R013	25
4480714b-a6f6-43cb-a997-86a8383d4d7e	d43eded1-69f1-427d-a695-70dbe56b69ef	79fad1b7-75b1-42c2-a934-4b6557f2d2c3	1	\N	fridge	\N	\N	Rolled up in cassette, leader inside. Fish leader before reloading.	2026-04-11 18:17:39.337677-07	2026-04-11 18:17:39.359-07	35mm	factory_roll	\N	\N	\N	R015	\N
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
d8987080-8d9c-4a53-a4f9-14a6de2805d3	d43eded1-69f1-427d-a695-70dbe56b69ef	deea6e69-42a7-4d93-bd6b-00e7fc92045a	1	1987	fridge	\N	\N	~39 years past expiration. Expect significant shifts and base fog. Rate down heavily at load time.\n\nRescue option: B&W cross-process, Rodinal stand 1+100, 20°C, 60 min, no agitation. Rate 1-2 stops below box. Expect low contrast + heavy base fog but usually scannable B&W.	2026-04-11 18:26:22.066932-07	2026-04-11 18:26:22.089-07	35mm	factory_roll	\N	\N	\N	\N	\N
de4378ff-d0da-4147-a2d3-06c67077af3a	d43eded1-69f1-427d-a695-70dbe56b69ef	561d839e-3459-4939-a777-422a92a2e205	1	1993	fridge	\N	\N	~30+ years past expiration. Unlikely to shoot.\n\nRescue option: B&W cross-process, Rodinal stand 1+100, 20°C, 60 min, no agitation. Rate 1-2 stops below box. Expect low contrast + heavy base fog but usually scannable B&W.	2026-04-11 18:40:02.772314-07	2026-04-11 18:40:02.772314-07	35mm	factory_roll	\N	\N	\N	\N	\N
13e8c31e-80e4-411e-85cf-f9d4708edcf7	d43eded1-69f1-427d-a695-70dbe56b69ef	362b021e-fd19-48fd-b6cc-4f5ee1ee5ba7	1	\N	fridge	\N	\N	Expiration unknown but stock dates to late 1980s–early 1990s; likely ~30+ years past expiration.\n\nRescue option: B&W cross-process, Rodinal stand 1+100, 20°C, 60 min, no agitation. Rate 1-2 stops below box. Expect low contrast + heavy base fog but usually scannable B&W.	2026-04-11 18:54:51.492874-07	2026-04-11 18:54:51.492874-07	35mm	factory_roll	\N	\N	\N	\N	\N
3f2bf5d1-6618-4bb1-866a-005f1906b731	d43eded1-69f1-427d-a695-70dbe56b69ef	5173fa4f-5925-477b-92b5-644394f564f2	1	~2005	fridge	\N	\N	Early 2000s stock. Likely ~20 years past expiration.\n\nRescue option: B&W cross-process, Rodinal stand 1+100, 20°C, 60 min, no agitation. Rate 1-2 stops below box. Expect low contrast + heavy base fog but usually scannable B&W.	2026-04-11 18:56:39.887349-07	2026-04-11 18:57:22.112-07	35mm	factory_roll	\N	\N	24	\N	\N
17ba9cc4-0934-4471-a8ad-ae4f509ab18a	d43eded1-69f1-427d-a695-70dbe56b69ef	27184828-62f2-4d45-84bf-8547db19dc36	1	\N	fridge	\N	\N	Sticker over plain black canister reading "Black's Slide Duplicating Film". No other info. Age unknown (Black's shut down 2015 so box is pre-2015 at minimum). Almost certainly expired.\n\nRescue option: B&W cross-process, Rodinal stand 1+100, 20°C, 60 min, no agitation. Rate 1-2 stops below box. Expect low contrast + heavy base fog but usually scannable B&W.	2026-04-11 18:59:35.557951-07	2026-04-11 18:59:35.581-07	35mm	factory_roll	\N	\N	\N	R021	\N
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
\.


--
-- Data for Name: frames; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.frames (id, roll_id, frame_number, lens_id, shutter_speed, aperture, compensation, metering_mode, subject, notes, latitude, longitude, location_name, shot_at, tags, rating, is_portfolio, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: lenses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.lenses (id, user_id, make, model, focal_length_mm, max_aperture, serial_number, notes, is_active, created_at, updated_at) FROM stdin;
2bfe90b8-f4e1-4e12-9f08-88c2318a8703	d43eded1-69f1-427d-a695-70dbe56b69ef	Leica	Summicron V3	50	2	\N	\N	t	2026-03-30 19:20:46.446001-07	2026-03-30 19:20:46.446001-07
0b3d2996-d8e0-4c06-acb4-739a08714409	d43eded1-69f1-427d-a695-70dbe56b69ef	Voigtlander	Nokton	40	1.4	\N	\N	t	2026-03-30 19:20:46.466937-07	2026-03-30 19:20:46.466937-07
4d5f5f5b-fbba-4248-833f-0aa6c6da76d7	d43eded1-69f1-427d-a695-70dbe56b69ef	Voigtlander	Color Skopar	28	2.8	\N	\N	t	2026-03-30 19:20:46.473649-07	2026-03-30 19:21:33.8-07
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

\unrestrict JuJeDrojXpEC9JvF4i95rax7Ze8OOUOgZO3k8xpJ053WZKtFtPd71e9JQdI7bJD

