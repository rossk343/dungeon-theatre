using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DungeonTheatre.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddFogAndTokenLighting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LightFeet",
                table: "Tokens",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "VisionFeet",
                table: "Tokens",
                type: "INTEGER",
                nullable: false,
                defaultValue: 30);

            migrationBuilder.AddColumn<string>(
                name: "FogAreasJson",
                table: "Scenes",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LightFeet",
                table: "Tokens");

            migrationBuilder.DropColumn(
                name: "VisionFeet",
                table: "Tokens");

            migrationBuilder.DropColumn(
                name: "FogAreasJson",
                table: "Scenes");
        }
    }
}
