--
-- PostgreSQL database dump
--

\restrict StgKoNu3cGhnazeAXW4xQq6zt3jZdNEx1CV6vp6SMKMsiIFvS0dkIvbx5L4bjg4

-- Dumped from database version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)
-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: enum_acknowledgements_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_acknowledgements_source AS ENUM (
    'app',
    'notification_action'
);


--
-- Name: enum_devices_platform; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_devices_platform AS ENUM (
    'android',
    'ios',
    'web'
);


--
-- Name: enum_events_event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_events_event_type AS ENUM (
    'meeting',
    'appointment',
    'reminder',
    'event'
);


--
-- Name: enum_events_recurrence_frequency; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_events_recurrence_frequency AS ENUM (
    'none',
    'daily',
    'weekly',
    'monthly'
);


--
-- Name: enum_events_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_events_status AS ENUM (
    'scheduled',
    'cancelled',
    'completed'
);


--
-- Name: enum_notification_attempts_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_notification_attempts_status AS ENUM (
    'accepted',
    'rejected',
    'error'
);


--
-- Name: enum_reminder_instances_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_reminder_instances_status AS ENUM (
    'pending',
    'processing',
    'sent',
    'failed',
    'acknowledged',
    'cancelled',
    'expired'
);


--
-- Name: enum_users_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enum_users_role AS ENUM (
    'admin',
    'user'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: acknowledgements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acknowledgements (
    id uuid NOT NULL,
    reminder_instance_id uuid NOT NULL,
    event_id uuid NOT NULL,
    user_id uuid NOT NULL,
    acknowledged_at timestamp with time zone NOT NULL,
    device_id uuid,
    source public.enum_acknowledgements_source DEFAULT 'app'::public.enum_acknowledgements_source NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid NOT NULL,
    actor_id uuid,
    action character varying(100) NOT NULL,
    resource character varying(100) NOT NULL,
    resource_id uuid,
    metadata jsonb,
    ip_address character varying(64),
    created_at timestamp with time zone NOT NULL
);


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    fcm_token character varying(512) NOT NULL,
    platform public.enum_devices_platform DEFAULT 'android'::public.enum_devices_platform NOT NULL,
    device_name character varying(150),
    is_active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: event_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_assignments (
    id uuid NOT NULL,
    event_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: event_reminder_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_reminder_rules (
    id uuid NOT NULL,
    event_id uuid NOT NULL,
    offset_minutes integer NOT NULL,
    label character varying(100),
    is_alarm boolean DEFAULT false NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    event_type public.enum_events_event_type DEFAULT 'meeting'::public.enum_events_event_type NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone,
    timezone character varying(64) NOT NULL,
    location character varying(255),
    meeting_link character varying(500),
    status public.enum_events_status DEFAULT 'scheduled'::public.enum_events_status NOT NULL,
    recurrence_frequency public.enum_events_recurrence_frequency DEFAULT 'none'::public.enum_events_recurrence_frequency NOT NULL,
    recurrence_interval integer DEFAULT 1 NOT NULL,
    recurrence_days_of_week jsonb,
    recurrence_end_at timestamp with time zone,
    created_by_id uuid NOT NULL,
    cancelled_at timestamp with time zone,
    cancellation_reason character varying(500),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: notification_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_attempts (
    id uuid NOT NULL,
    reminder_instance_id uuid NOT NULL,
    device_id uuid,
    attempt_number integer NOT NULL,
    status public.enum_notification_attempts_status NOT NULL,
    provider_message_id character varying(255),
    error_code character varying(120),
    error_message character varying(1000),
    created_at timestamp with time zone NOT NULL
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id integer NOT NULL,
    user_id uuid NOT NULL,
    token character varying(500) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.refresh_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.refresh_tokens_id_seq OWNED BY public.refresh_tokens.id;


--
-- Name: reminder_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminder_instances (
    id uuid NOT NULL,
    event_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    rule_id uuid NOT NULL,
    user_id uuid NOT NULL,
    occurrence_start timestamp with time zone NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    status public.enum_reminder_instances_status DEFAULT 'pending'::public.enum_reminder_instances_status NOT NULL,
    is_alarm boolean DEFAULT false NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    locked_at timestamp with time zone,
    locked_by character varying(100),
    sent_at timestamp with time zone,
    last_error character varying(1000),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(255) NOT NULL,
    password character varying(255) NOT NULL,
    full_name character varying(150) NOT NULL,
    phone character varying(20),
    role public.enum_users_role DEFAULT 'user'::public.enum_users_role NOT NULL,
    timezone character varying(64) DEFAULT 'Asia/Kolkata'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('public.refresh_tokens_id_seq'::regclass);


--
-- Name: acknowledgements acknowledgements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acknowledgements
    ADD CONSTRAINT acknowledgements_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: devices devices_fcm_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_fcm_token_key UNIQUE (fcm_token);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: event_assignments event_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_assignments
    ADD CONSTRAINT event_assignments_pkey PRIMARY KEY (id);


--
-- Name: event_reminder_rules event_reminder_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_reminder_rules
    ADD CONSTRAINT event_reminder_rules_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: notification_attempts notification_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_attempts
    ADD CONSTRAINT notification_attempts_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: reminder_instances reminder_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_instances
    ADD CONSTRAINT reminder_instances_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: acknowledgements_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX acknowledgements_event_id ON public.acknowledgements USING btree (event_id);


--
-- Name: acknowledgements_reminder_instance_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX acknowledgements_reminder_instance_id ON public.acknowledgements USING btree (reminder_instance_id);


--
-- Name: acknowledgements_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX acknowledgements_user_id ON public.acknowledgements USING btree (user_id);


--
-- Name: audit_logs_actor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_actor_id ON public.audit_logs USING btree (actor_id);


--
-- Name: audit_logs_resource_resource_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_resource_resource_id ON public.audit_logs USING btree (resource, resource_id);


--
-- Name: devices_user_id_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_user_id_is_active ON public.devices USING btree (user_id, is_active);


--
-- Name: event_assignments_event_id_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX event_assignments_event_id_user_id ON public.event_assignments USING btree (event_id, user_id);


--
-- Name: event_assignments_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_assignments_user_id ON public.event_assignments USING btree (user_id);


--
-- Name: event_reminder_rules_event_id_offset_minutes; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX event_reminder_rules_event_id_offset_minutes ON public.event_reminder_rules USING btree (event_id, offset_minutes);


--
-- Name: events_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_created_by_id ON public.events USING btree (created_by_id);


--
-- Name: events_start_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_start_at ON public.events USING btree (start_at);


--
-- Name: events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_status ON public.events USING btree (status);


--
-- Name: notification_attempts_device_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_attempts_device_id ON public.notification_attempts USING btree (device_id);


--
-- Name: notification_attempts_reminder_instance_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_attempts_reminder_instance_id ON public.notification_attempts USING btree (reminder_instance_id);


--
-- Name: reminder_instances_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reminder_instances_dedupe ON public.reminder_instances USING btree (assignment_id, rule_id, occurrence_start);


--
-- Name: reminder_instances_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminder_instances_due ON public.reminder_instances USING btree (status, scheduled_at);


--
-- Name: reminder_instances_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminder_instances_event_id ON public.reminder_instances USING btree (event_id);


--
-- Name: reminder_instances_user_id_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminder_instances_user_id_status ON public.reminder_instances USING btree (user_id, status);


--
-- Name: acknowledgements acknowledgements_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acknowledgements
    ADD CONSTRAINT acknowledgements_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: acknowledgements acknowledgements_reminder_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acknowledgements
    ADD CONSTRAINT acknowledgements_reminder_instance_id_fkey FOREIGN KEY (reminder_instance_id) REFERENCES public.reminder_instances(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: acknowledgements acknowledgements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acknowledgements
    ADD CONSTRAINT acknowledgements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: devices devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_assignments event_assignments_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_assignments
    ADD CONSTRAINT event_assignments_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_assignments event_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_assignments
    ADD CONSTRAINT event_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_reminder_rules event_reminder_rules_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_reminder_rules
    ADD CONSTRAINT event_reminder_rules_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: events events_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notification_attempts notification_attempts_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_attempts
    ADD CONSTRAINT notification_attempts_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notification_attempts notification_attempts_reminder_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_attempts
    ADD CONSTRAINT notification_attempts_reminder_instance_id_fkey FOREIGN KEY (reminder_instance_id) REFERENCES public.reminder_instances(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reminder_instances reminder_instances_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_instances
    ADD CONSTRAINT reminder_instances_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.event_assignments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reminder_instances reminder_instances_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_instances
    ADD CONSTRAINT reminder_instances_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reminder_instances reminder_instances_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_instances
    ADD CONSTRAINT reminder_instances_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.event_reminder_rules(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reminder_instances reminder_instances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_instances
    ADD CONSTRAINT reminder_instances_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict StgKoNu3cGhnazeAXW4xQq6zt3jZdNEx1CV6vp6SMKMsiIFvS0dkIvbx5L4bjg4

