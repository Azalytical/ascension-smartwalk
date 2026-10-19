[out:json][timeout:150][bbox:51.04,71.28,51.23,71.62];
(
  nwr[amenity~"^(cafe|restaurant|fast_food|food_court|ice_cream|bar|pub|arts_centre|theatre|cinema|library|exhibition_centre)$"];
  nwr[tourism~"^(museum|gallery|attraction|viewpoint|artwork|zoo|theme_park)$"];
  nwr[leisure~"^(park|garden|playground|nature_reserve)$"];
  nwr[historic~"^(monument|memorial|castle|ruins|archaeological_site)$"];
  nwr[shop=mall];
);
out meta center;
