// Clerk needs its browser runtime; screens rendered in tests get a signed-out, empty billing state.
import { createElement, type ReactNode } from "react";
export const useAuth = () => ({ isLoaded: true, isSignedIn: false, userId: null });
export const useSubscription = () => ({ data: null, isLoading: false, error: null, revalidate: () => {} });
export const usePlans = () => ({ data: [], isLoading: false, isFetching: false, error: null });
export const UserButton = () => null;
export const CheckoutButton = ({ children }: { children: ReactNode }) => createElement("span", null, children);
export const SubscriptionDetailsButton = ({ children }: { children: ReactNode }) => createElement("span", null, children);
export const PricingTable = () => null;
