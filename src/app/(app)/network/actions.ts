"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import {
  allocateNextIp,
  bulkCreatePorts,
  deletePort,
  deleteRack,
  deleteSubnet,
  deleteVlan,
  deleteWifi,
  mountInRack,
  releaseIp,
  savePort,
  saveIp,
  saveRack,
  saveSubnet,
  saveVlan,
  saveWifi,
  unmount,
} from "@/server/modules/network";
import type { Ctx } from "@/server/context";

/** Runs a network write and redirects to the returned path; errors come back to the form. */
async function run(fn: (ctx: Ctx) => Promise<string>): Promise<ActionState> {
  let target: string;
  try {
    target = await fn(await requireCtx());
  } catch (e) {
    return toActionError(e);
  }
  redirect(target);
}

// VLANs
export const saveVlanAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => (await saveVlan(ctx, id, formToObject(fd)), "/network?tab=vlans"));
export const deleteVlanAction = async (id: string, _: ActionState) => run(async (ctx) => (await deleteVlan(ctx, id), "/network?tab=vlans"));

// Subnets & IPs
export const saveSubnetAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/network/subnets/${(await saveSubnet(ctx, id, formToObject(fd))).id}`);
export const deleteSubnetAction = async (id: string, _: ActionState) => run(async (ctx) => (await deleteSubnet(ctx, id), "/network?tab=subnets"));
export const saveIpAction = async (subnetId: string, id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/network/subnets/${subnetId}?ip=${(await saveIp(ctx, subnetId, id, formToObject(fd))).address}`);
export const allocateIpAction = async (subnetId: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/network/subnets/${subnetId}?ip=${(await allocateNextIp(ctx, subnetId, formToObject(fd))).address}`);
export const releaseIpAction = async (subnetId: string, id: string, _: ActionState) =>
  run(async (ctx) => (await releaseIp(ctx, id), `/network/subnets/${subnetId}`));

// Racks
export const saveRackAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/network/racks/${(await saveRack(ctx, id, formToObject(fd))).id}`);
export const deleteRackAction = async (id: string, _: ActionState) => run(async (ctx) => (await deleteRack(ctx, id), "/network?tab=racks"));
export const mountAction = async (rackId: string, mountId: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => (await mountInRack(ctx, rackId, mountId, formToObject(fd)), `/network/racks/${rackId}`));
export const unmountAction = async (rackId: string, mountId: string, _: ActionState) =>
  run(async (ctx) => (await unmount(ctx, mountId), `/network/racks/${rackId}`));

// Switch ports
export const savePortAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/network?tab=ports&switchId=${(await savePort(ctx, id, formToObject(fd))).switchId}`);
export const bulkPortsAction = async (_: ActionState, fd: FormData) =>
  run(async (ctx) => {
    const input = formToObject(fd);
    await bulkCreatePorts(ctx, input);
    return `/network?tab=ports&switchId=${input.switchId}`;
  });
export const deletePortAction = async (switchId: string, id: string, _: ActionState) =>
  run(async (ctx) => (await deletePort(ctx, id), `/network?tab=ports&switchId=${switchId}`));

// Wi-Fi
export const saveWifiAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => (await saveWifi(ctx, id, formToObject(fd)), "/network?tab=wifi"));
export const deleteWifiAction = async (id: string, _: ActionState) => run(async (ctx) => (await deleteWifi(ctx, id), "/network?tab=wifi"));
