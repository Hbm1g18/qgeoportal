const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Serve static files

const pool = new Pool({
  user: "postgres",
  host: "",
  database: "qgeoportal",
  password: "",
  port: 5432,
});

// Create a new layer
app.post("/api/layers", async (req, res) => {
    const { title, description, geomType, attributes, groupId, crs } = req.body;
    const table_name = title.toLowerCase().replace(/\s+/g, "_");
    const layer_id = uuidv4();
    const assignedGroupId = groupId || "00000000-0000-0000-0000-000000000000"; // Default to "Ungrouped"

    try {
        // Insert into the layers metadata table
        await pool.query(
            "INSERT INTO layers (id, table_name, display_name, description, geom_type, group_id, crs) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [layer_id, table_name, title, description, geomType, assignedGroupId, crs]
        );

        // Construct the SQL query to create the PostGIS table
        let createQuery = `
            CREATE TABLE ${table_name} (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                geom geometry(${geomType}, ${crs})
        `;

        // Add user-defined attribute columns
        attributes.forEach(attr => {
            createQuery += `, ${attr.name} ${attr.type}`;
        });

        createQuery += ");"; // Close the CREATE TABLE statement

        // Execute the table creation query
        await pool.query(createQuery);

        res.json({ success: true, id: layer_id, message: "Layer created successfully" });
    } catch (error) {
        console.error("Error creating layer:", error);
        res.status(500).json({ error: "Failed to create layer" });
    }
});


// Get all layers
app.get("/api/layers", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM layers");
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching layers");
  }
});

// Create a new group
app.post("/api/groups", async (req, res) => {
  const { name } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO groups (name) VALUES ($1) RETURNING *",
      [name]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating group");
  }
});

// Assign a layer to a group
app.post("/api/group_layers", async (req, res) => {
  const { group_id, layer_id } = req.body;
  try {
    await pool.query(
      "INSERT INTO group_layers (group_id, layer_id) VALUES ($1, $2)",
      [group_id, layer_id]
    );
    res.send("Layer assigned to group");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error assigning layer to group");
  }
});

// Get layers for a specific group
app.get("/api/groups/:group_id/layers", async (req, res) => {
    const { group_id } = req.params;

    try {
        const result = await pool.query(
            "SELECT * FROM layers WHERE group_id = $1",
            [group_id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).send("Error fetching layers for group");
    }
});

app.post("/api/groups", async (req, res) => {
    const { name } = req.body;
    const group_id = require("crypto").randomUUID();

    try {
        const result = await pool.query(
            "INSERT INTO groups (id, name) VALUES ($1, $2) RETURNING *",
            [group_id, name]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).send("Error creating group");
    }
});

app.get("/api/groups", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM groups");
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch groups" });
    }
});

app.post("/api/groups", async (req, res) => {
    const { name } = req.body;
    const group_id = uuidv4();

    try {
        // Insert new group
        const result = await pool.query(
            "INSERT INTO groups (id, name) VALUES ($1, $2) RETURNING *",
            [group_id, name]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error creating group:", error);
        res.status(500).json({ error: "Failed to create group" });
    }
});

app.delete("/api/layers/:id", async (req, res) => {
    const { id } = req.params;

    try {
        // Get the table name before deleting the layer metadata
        const result = await pool.query("SELECT table_name FROM layers WHERE id = $1", [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Layer not found" });
        }

        const tableName = result.rows[0].table_name;

        // Delete layer metadata
        await pool.query("DELETE FROM layers WHERE id = $1", [id]);

        // Drop the corresponding PostGIS table
        await pool.query(`DROP TABLE IF EXISTS ${tableName}`);

        res.json({ success: true, message: "Layer deleted successfully" });
    } catch (error) {
        console.error("Error deleting layer:", error);
        res.status(500).json({ error: "Failed to delete layer" });
    }
});

app.post("/api/maps/:id/layers", async (req, res) => {
    const { id } = req.params;
    const { layerIds } = req.body;

    try {
        for (const layerId of layerIds) {
            await pool.query(
                "INSERT INTO map_layers (map_id, layer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                [id, layerId]
            );
        }
        res.json({ success: true, message: "Layers added to map successfully" });
    } catch (error) {
        console.error("Error adding layers to map:", error);
        res.status(500).json({ error: "Failed to add layers to map" });
    }
});

app.get("/api/maps/:id/layers", async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT l.id, l.display_name, l.geom_type, l.crs, l.table_name 
             FROM layers l
             JOIN map_layers ml ON l.id = ml.layer_id
             WHERE ml.map_id = $1`,
            [id]
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching layers for map:", error);
        res.status(500).json({ error: "Failed to fetch layers for map" });
    }
});



app.post("/api/maps", async (req, res) => {
    const { name, description } = req.body;
    const map_id = uuidv4();

    try {
        const result = await pool.query(
            "INSERT INTO maps (id, name, description) VALUES ($1, $2, $3) RETURNING *",
            [map_id, name, description]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error creating map:", error);
        res.status(500).json({ error: "Failed to create map" });
    }
});

app.get("/api/maps", async (req, res) => {
    const result = await pool.query("SELECT * FROM maps");
    res.json(result.rows);
});

app.get("/api/maps/:id", async (req, res) => {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM maps WHERE id = $1", [id]);
    res.json(result.rows[0]);
});

app.get("/api/layers/:id/geojson", async (req, res) => {
    const { id } = req.params;

    try {
        // Get layer details
        const layerResult = await pool.query("SELECT table_name, crs FROM layers WHERE id = $1", [id]);

        if (layerResult.rows.length === 0) {
            return res.status(404).json({ error: "Layer not found" });
        }

        const { table_name, crs } = layerResult.rows[0];

        // Convert CRS if necessary (27700 → 4326 for Leaflet)
        const geomColumn = crs === "27700" 
            ? "ST_AsGeoJSON(ST_Transform(geom, 4326))"  // Convert British National Grid to WGS 84
            : "ST_AsGeoJSON(geom)";

        // Fetch all geometries from the table
        const result = await pool.query(
            `SELECT ${geomColumn} as geojson, * FROM ${table_name}`
        );

        // Convert results to valid GeoJSON format
        const geojson = {
            type: "FeatureCollection",
            features: result.rows.map(row => ({
                type: "Feature",
                geometry: JSON.parse(row.geojson),
                properties: Object.fromEntries(
                    Object.entries(row).filter(([key]) => key !== "geojson" && key !== "geom")
                )
            }))
        };

        res.json(geojson);
    } catch (error) {
        console.error("Error fetching GeoJSON:", error);
        res.status(500).json({ error: "Failed to fetch GeoJSON" });
    }
});

app.delete("/api/maps/:mapId/layers/:layerId", async (req, res) => {
    const { mapId, layerId } = req.params;

    try {
        await pool.query("DELETE FROM map_layers WHERE map_id = $1 AND layer_id = $2", [mapId, layerId]);
        res.json({ success: true });
    } catch (error) {
        console.error("Error removing layer from map:", error);
        res.status(500).json({ error: "Failed to remove layer from map" });
    }
});



app.listen(3030, () => {
    console.log("Server running on http://localhost:3030");
  });
